import { promises as fs } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { RepsilDb } from '../db'
import type { DocumentRow } from '../db/queries'
import { resolveInsideArchive } from '../pathSafety'
import { extOf } from '../watcher/paths'
import type { SyncedMeta, SyncMessage } from './protocol'

type FileMessage = Extract<SyncMessage, { t: 'file' }>

function metaOf(row: DocumentRow | undefined): SyncedMeta {
  return {
    title: row?.title ?? null,
    doc_date: row?.doc_date ?? null,
    source: row?.source ?? null,
    notes: row?.notes ?? null,
    user_edited_fields: row?.user_edited_fields ?? '[]',
    meta_updated_at: row?.meta_updated_at ?? null
  }
}

/** Read a local file + its curated metadata into a FILE message for a peer. */
export async function readForSync(repsil: RepsilDb, relPath: string): Promise<FileMessage | null> {
  const safe = resolveInsideArchive(repsil.rootPath, relPath)
  if (!safe) return null
  let data: Buffer
  let st: import('node:fs').Stats
  try {
    data = await fs.readFile(safe)
    st = await fs.stat(safe)
  } catch {
    return null
  }
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  return {
    t: 'file',
    rel_path: relPath,
    content_hash: row?.content_hash ?? null,
    size_bytes: st.size,
    mtime: st.mtimeMs,
    dataB64: data.toString('base64'),
    meta: metaOf(row)
  }
}

/** A META message carrying just the curated metadata for a path. */
export function metaMessageFor(
  repsil: RepsilDb,
  relPath: string
): Extract<SyncMessage, { t: 'meta' }> | null {
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return null
  return { t: 'meta', rel_path: relPath, meta: metaOf(row) }
}

/**
 * Apply curated metadata from a peer, last-writer-wins by meta_updated_at. The
 * winner's user_edited_fields travel too, so local auto-guess keeps respecting
 * human edits afterwards.
 */
export function applyIncomingMeta(repsil: RepsilDb, relPath: string, meta: SyncedMeta): void {
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return
  const localTs = row.meta_updated_at ?? 0
  const remoteTs = meta.meta_updated_at ?? 0
  if (remoteTs <= localTs) return
  repsil.queries.upsertSyncedMetadata.run({
    rel_path: relPath,
    title: meta.title,
    doc_date: meta.doc_date,
    source: meta.source,
    notes: meta.notes,
    user_edited_fields: meta.user_edited_fields,
    meta_updated_at: meta.meta_updated_at ?? Date.now(),
    last_writer: null
  })
}

/**
 * Write an incoming file into the archive and ensure a DB row exists. The
 * watcher will see a row whose mtime/size already match (no-op), and local
 * extraction re-derives text. Curated metadata is applied LWW afterwards.
 */
export async function applyIncomingFile(
  repsil: RepsilDb,
  msg: FileMessage,
  enqueue: (id: number) => void
): Promise<void> {
  const safe = resolveInsideArchive(repsil.rootPath, msg.rel_path)
  if (!safe) return
  await fs.mkdir(dirname(safe), { recursive: true })
  await fs.writeFile(safe, Buffer.from(msg.dataB64, 'base64'))
  const st = await fs.stat(safe)

  const existing = repsil.queries.getDocumentByRelPath.get(msg.rel_path) as DocumentRow | undefined
  if (!existing) {
    repsil.queries.insertDocument.run({
      rel_path: msg.rel_path,
      filename: basename(msg.rel_path),
      ext: extOf(msg.rel_path),
      size_bytes: st.size,
      mtime: st.mtimeMs,
      ctime: st.ctimeMs
    })
  } else {
    repsil.queries.updateDocumentMtime.run({
      rel_path: msg.rel_path,
      mtime: st.mtimeMs,
      size_bytes: st.size
    })
  }

  applyIncomingMeta(repsil, msg.rel_path, msg.meta)

  const row = repsil.queries.getDocumentByRelPath.get(msg.rel_path) as DocumentRow | undefined
  if (row) enqueue(row.id)
}

/** Delete a file locally because a peer deleted it more recently. */
export async function applyTombstone(
  repsil: RepsilDb,
  relPath: string,
  contentHash: string | null,
  deletedAt: number
): Promise<void> {
  const safe = resolveInsideArchive(repsil.rootPath, relPath)
  if (safe) {
    try {
      await fs.unlink(safe)
    } catch {
      // already gone
    }
  }
  repsil.queries.deleteDocumentByRelPath.run(relPath)
  repsil.queries.insertTombstone.run({
    rel_path: relPath,
    content_hash: contentHash,
    deleted_at: deletedAt,
    device: null
  })
}
