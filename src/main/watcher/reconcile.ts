import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { RepsilDb } from '../db'
import type { DocumentRow } from '../db/queries'
import { inheritsFolderFlag } from '../folders'
import { emitFileChanged } from '../sync/bus'
import { extOf, isIgnoredRel, toRel } from './paths'

/**
 * Walk the archive tree once on startup, then diff against the documents
 * table. Inserts new files, updates changed ones, removes vanished ones.
 * Returns a tally for logging / UI.
 */
export async function reconcile(repsil: RepsilDb): Promise<{
  inserted: number
  updated: number
  removed: number
  scanned: number
}> {
  const onDisk = new Map<string, { abs: string; size: number; mtime: number; ctime: number }>()
  await walk(repsil.rootPath, repsil.rootPath, onDisk)

  const all = repsil.db
    .prepare(`SELECT rel_path, size_bytes, mtime FROM documents`)
    .all() as Pick<DocumentRow, 'rel_path' | 'size_bytes' | 'mtime'>[]

  const knownByRel = new Map(all.map((d) => [d.rel_path, d]))

  let inserted = 0
  let updated = 0
  let removed = 0

  // Process in chunks, each its own transaction, yielding the event loop in
  // between so a huge initial scan can't freeze IPC / the UI (P4).
  const CHUNK = 500
  const diskEntries = [...onDisk.entries()]

  const upsertChunk = repsil.db.transaction(
    (entries: [string, { size: number; mtime: number; ctime: number }][]) => {
      for (const [rel, info] of entries) {
        const known = knownByRel.get(rel)
        if (!known) {
          const r = repsil.queries.insertDocument.run({
            rel_path: rel,
            filename: basename(rel),
            ext: extOf(rel),
            size_bytes: info.size,
            mtime: info.mtime,
            ctime: info.ctime
          })
          if (inheritsFolderFlag(repsil, rel, 'ocr_default')) {
            repsil.queries.setOcrRequested.run(Number(r.lastInsertRowid))
          }
          inserted++
        } else if (known.mtime !== info.mtime || known.size_bytes !== info.size) {
          repsil.queries.updateDocumentMtime.run({
            rel_path: rel,
            mtime: info.mtime,
            size_bytes: info.size
          })
          updated++
        }
      }
    }
  )

  for (let i = 0; i < diskEntries.length; i += CHUNK) {
    upsertChunk(diskEntries.slice(i, i + CHUNK))
    await yieldToLoop()
  }

  const removals = [...knownByRel.keys()].filter((rel) => !onDisk.has(rel))
  const removeChunk = repsil.db.transaction((rels: string[]) => {
    for (const rel of rels) {
      repsil.queries.deleteDocumentByRelPath.run(rel)
      removed++
    }
  })
  for (let i = 0; i < removals.length; i += CHUNK) {
    removeChunk(removals.slice(i, i + CHUNK))
    await yieldToLoop()
  }

  // Note: enqueueing for inserted/updated rows is the queue's job — see
  // drainPending(). Reconcile leaves them in extraction_status='pending' and
  // the queue drains them on the next tick.

  // Fire ONE bus event when anything changed. The IPC layer subscribes and
  // broadcasts documents:changed to all windows, so the dashboard refreshes
  // its list. Without this, files surfaced only by reconcile (because chokidar
  // missed the FS event, or because the file was added while the watcher was
  // down) would sit invisible until the user changed the search query.
  if (inserted > 0 || updated > 0 || removed > 0) {
    emitFileChanged('')
  }

  return { inserted, updated, removed, scanned: onDisk.size }
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function walk(
  root: string,
  dir: string,
  out: Map<string, { abs: string; size: number; mtime: number; ctime: number }>
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    const rel = toRel(root, abs)
    if (isIgnoredRel(rel)) continue
    if (entry.isDirectory()) {
      await walk(root, abs, out)
    } else if (entry.isFile()) {
      try {
        const st = await fs.stat(abs)
        out.set(rel, { abs, size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs })
      } catch {
        // unreadable / vanished mid-scan — skip
      }
    }
  }
}
