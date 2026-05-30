import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { RepsilDb } from './db'
import type { DocumentRow, TombstoneRow, TrashItemRow } from './db/queries'
import { resolveInsideArchive } from './pathSafety'
import { emitDeleted, emitFileChanged } from './sync/bus'

/**
 * Returns the absolute path to the directory that holds trashed file bytes for
 * a given archive. Layout: <root>/.repsil/trash/<trash_id>/<original-filename>.
 *
 * Each deletion gets its own trash_id directory so collisions are impossible
 * (two files named report.pdf trashed at different times stay distinct) and
 * because peers reuse the same trash_id, the "shared" identity is the trash_id.
 */
function trashRoot(rootPath: string): string {
  return join(rootPath, '.repsil', 'trash')
}

export function trashFileAbs(rootPath: string, trashId: string, filename: string): string {
  return join(trashRoot(rootPath), trashId, filename)
}

export interface MoveToTrashResult {
  trashId: string
  rel_path: string
  filename: string
}

/**
 * Move a document into the shared trash:
 *   1. Read its DB row + current bytes.
 *   2. Copy bytes to .repsil/trash/<trash_id>/<filename>.
 *   3. Insert/update a tombstone with trash_id and the metadata snapshot.
 *   4. Remove the original file + DB row.
 *
 * Snapshots are written BEFORE the DB row is deleted so a restore (here or on
 * a peer) recovers the title/date/source/notes the user had curated.
 *
 * If the document doesn't exist, returns null (no-op).
 */
export async function moveToTrash(
  repsil: RepsilDb,
  relPath: string,
  deletedByDevice: string | null
): Promise<MoveToTrashResult | null> {
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return null

  const abs = resolveInsideArchive(repsil.rootPath, relPath)
  if (!abs) return null

  const trashId = randomUUID()
  const filename = row.filename
  const trashDir = join(trashRoot(repsil.rootPath), trashId)
  const trashPath = join(trashDir, filename)
  await fs.mkdir(trashDir, { recursive: true })

  // Copy first, then unlink — if the copy fails, we don't lose the original.
  try {
    await fs.copyFile(abs, trashPath)
  } catch (err) {
    // Best-effort cleanup of the empty trash dir we just created.
    try {
      await fs.rmdir(trashDir)
    } catch {
      /* ignore */
    }
    throw err
  }

  const deletedAt = Date.now()
  repsil.queries.insertTombstone.run({
    rel_path: relPath,
    content_hash: row.content_hash,
    deleted_at: deletedAt,
    device: deletedByDevice,
    trash_id: trashId,
    filename,
    ext: row.ext,
    size_bytes: row.size_bytes,
    deleted_by: deletedByDevice,
    snap_title: row.title,
    snap_doc_date: row.doc_date,
    snap_source: row.source,
    snap_notes: row.notes,
    snap_user_edited_fields: row.user_edited_fields
  })
  repsil.queries.deleteDocumentByRelPath.run(relPath)

  // Remove the original file last. If this throws (e.g. another process holds
  // a handle), the trash copy + tombstone are still consistent; the next
  // reconcile will retry the unlink.
  try {
    await fs.unlink(abs)
  } catch (err) {
    console.error(`moveToTrash: failed to unlink original ${abs}:`, err)
  }

  // Broadcast both events so peers learn of the deletion AND the local
  // dashboard refreshes its listing.
  emitDeleted(relPath, row.content_hash, deletedAt)
  emitFileChanged(relPath)

  return { trashId, rel_path: relPath, filename }
}

/**
 * Move an incoming peer's tombstone into our local trash. The peer already
 * sent the metadata snapshot; we re-use the same trash_id so the shared trash
 * view has one canonical entry across devices. If we still have the file
 * locally, its bytes move into our own .repsil/trash/<trash_id>/. If not,
 * we just record the tombstone with the snapshot so the trash item is still
 * listable (restore would simply fail if no bytes are available).
 */
export async function adoptIncomingTombstone(
  repsil: RepsilDb,
  t: {
    rel_path: string
    content_hash: string | null
    deleted_at: number
    trash_id: string | null
    filename: string | null
    ext: string | null
    size_bytes: number | null
    deleted_by: string | null
    snap_title: string | null
    snap_doc_date: string | null
    snap_source: string | null
    snap_notes: string | null
    snap_user_edited_fields: string | null
  }
): Promise<void> {
  let trashId = t.trash_id
  let filename = t.filename

  // If the peer included a trash bundle and we still have the file, move our
  // local copy into our own .repsil/trash/<trash_id>/ so we can independently
  // restore it.
  if (trashId && filename) {
    const safe = resolveInsideArchive(repsil.rootPath, t.rel_path)
    if (safe) {
      const trashDir = join(trashRoot(repsil.rootPath), trashId)
      const trashPath = join(trashDir, filename)
      try {
        await fs.mkdir(trashDir, { recursive: true })
        await fs.copyFile(safe, trashPath)
        await fs.unlink(safe)
      } catch {
        // File may have already vanished locally; we still record the
        // tombstone so the trash listing shows the entry (without local
        // bytes to restore from).
        try {
          await fs.access(trashPath)
        } catch {
          // No local bytes preserved. Clear the trash_id from what we write
          // so the UI doesn't offer Restore on this device.
          trashId = null
          filename = null
        }
      }
    }
  } else {
    // Plain tombstone (peer deleted via Explorer, no preserved bytes). Just
    // unlink locally if we still have it.
    const safe = resolveInsideArchive(repsil.rootPath, t.rel_path)
    if (safe) {
      try {
        await fs.unlink(safe)
      } catch {
        /* already gone */
      }
    }
  }

  repsil.queries.deleteDocumentByRelPath.run(t.rel_path)
  repsil.queries.insertTombstone.run({
    rel_path: t.rel_path,
    content_hash: t.content_hash,
    deleted_at: t.deleted_at,
    device: t.deleted_by,
    trash_id: trashId,
    filename,
    ext: t.ext,
    size_bytes: t.size_bytes,
    deleted_by: t.deleted_by,
    snap_title: t.snap_title,
    snap_doc_date: t.snap_doc_date,
    snap_source: t.snap_source,
    snap_notes: t.snap_notes,
    snap_user_edited_fields: t.snap_user_edited_fields
  })
}

/**
 * Move a trashed file back to the archive. On collision (something now exists
 * at the original rel_path), append " (restored)" before the extension. The
 * watcher will see the add event, insert the row, and sync will propagate it
 * back to peers — which on receipt will remove their own tombstone since the
 * file's mtime is now newer than the recorded deletion.
 */
export async function restoreFromTrash(repsil: RepsilDb, trashId: string): Promise<string | null> {
  const t = repsil.queries.getTombstoneByTrashId.get(trashId) as TombstoneRow | undefined
  if (!t || !t.trash_id || !t.filename) return null

  const src = trashFileAbs(repsil.rootPath, t.trash_id, t.filename)
  try {
    await fs.access(src)
  } catch {
    return null
  }

  let destRel = t.rel_path
  let destAbs = resolveInsideArchive(repsil.rootPath, destRel)
  if (!destAbs) return null

  // Avoid clobbering a file that exists at the original path now.
  if (await pathExists(destAbs)) {
    const ext = extname(t.filename)
    const stem = t.filename.slice(0, t.filename.length - ext.length)
    const dirRel = dirname(destRel) === '.' ? '' : dirname(destRel)
    for (let i = 1; i < 10000; i++) {
      const candidateName = `${stem} (restored ${i})${ext}`
      const candidateRel = dirRel ? `${dirRel}/${candidateName}` : candidateName
      const candidateAbs = resolveInsideArchive(repsil.rootPath, candidateRel)
      if (candidateAbs && !(await pathExists(candidateAbs))) {
        destRel = candidateRel
        destAbs = candidateAbs
        break
      }
    }
  }

  await fs.mkdir(dirname(destAbs), { recursive: true })
  await fs.copyFile(src, destAbs)

  // Best-effort: remove the trash file + directory now that bytes are back.
  try {
    await fs.unlink(src)
    await fs.rmdir(join(trashRoot(repsil.rootPath), t.trash_id))
  } catch {
    /* ignore */
  }

  // Drop the tombstone entirely — the file is no longer deleted. Peers that
  // still have the tombstone will accept the restored file because its mtime
  // is newer than their recorded deleted_at (handled in apply.ts).
  repsil.queries.deleteTombstone.run(t.rel_path)

  emitFileChanged(destRel)
  return destRel
}

/**
 * Permanently delete a trash item's bytes. Keeps the tombstone (so the
 * deletion still propagates to peers) but clears the trash pointer. The full
 * tombstone is then GC'd by the periodic sweeper after the retention window.
 */
export async function purgeFromTrash(repsil: RepsilDb, trashId: string): Promise<boolean> {
  const t = repsil.queries.getTombstoneByTrashId.get(trashId) as TombstoneRow | undefined
  if (!t || !t.trash_id || !t.filename) return false
  const trashPath = trashFileAbs(repsil.rootPath, t.trash_id, t.filename)
  try {
    await fs.unlink(trashPath)
  } catch {
    /* already gone */
  }
  try {
    await fs.rmdir(join(trashRoot(repsil.rootPath), t.trash_id))
  } catch {
    /* may have siblings or already gone */
  }
  repsil.queries.clearTombstoneTrash.run(t.rel_path)
  return true
}

/** UI listing: trash items with bytes still on disk in this archive. */
export function listTrash(repsil: RepsilDb): TrashItemRow[] {
  return repsil.queries.listTrashItems.all() as TrashItemRow[]
}

/**
 * 30-day retention sweep: purge trash files older than the cutoff, then run
 * the existing pruneTombstones to garbage-collect the rows themselves.
 */
export async function sweepTrash(repsil: RepsilDb, retentionMs: number): Promise<{ purged: number }> {
  const cutoff = Date.now() - retentionMs
  const items = repsil.queries.listTrashItemsOlderThan.all(cutoff) as TrashItemRow[]
  let purged = 0
  for (const item of items) {
    try {
      await fs.unlink(trashFileAbs(repsil.rootPath, item.trash_id, item.filename))
    } catch {
      /* already gone */
    }
    try {
      await fs.rmdir(join(trashRoot(repsil.rootPath), item.trash_id))
    } catch {
      /* ignore */
    }
    repsil.queries.clearTombstoneTrash.run(item.rel_path)
    purged++
  }
  repsil.queries.pruneTombstones.run(cutoff)
  return { purged }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}
