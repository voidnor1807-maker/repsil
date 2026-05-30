import chokidar, { type FSWatcher } from 'chokidar'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { RepsilDb } from '../db'
import type { DocumentRow } from '../db/queries'
import { drainPending, enqueueExtraction } from '../extraction/queue'
import { inheritsFolderFlag } from '../folders'
import { recordDeletion } from '../renameTracker'
import { emitDeleted, emitFileChanged } from '../sync/bus'
import { extOf, isIgnoredRel, toRel } from './paths'
import { reconcile } from './reconcile'

export interface WatcherHandle {
  stop: () => Promise<void>
  rootPath: string
}

let active: { handle: WatcherHandle; reconcileTimer: NodeJS.Timeout | null } | null = null

/**
 * Idempotent: starting a watcher for the same rootPath is a no-op.
 * Different rootPath stops the previous one first.
 */
export async function startWatcher(repsil: RepsilDb): Promise<WatcherHandle> {
  if (active && active.handle.rootPath === repsil.rootPath) return active.handle
  if (active) await stopWatcher()

  // Initial reconcile before live events start
  await reconcile(repsil).catch((err) => {
    console.error('Initial reconcile failed:', err)
  })

  const watcher: FSWatcher = chokidar.watch(repsil.rootPath, {
    ignored: (p: string) => {
      const rel = toRel(repsil.rootPath, p)
      return isIgnoredRel(rel)
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
    atomic: true
  })

  const onUpsert = async (abs: string): Promise<void> => {
    const rel = toRel(repsil.rootPath, abs)
    if (isIgnoredRel(rel)) return
    let st: import('node:fs').Stats
    try {
      st = await fs.stat(abs)
    } catch {
      return
    }
    if (!st.isFile()) return

    const existing = repsil.queries.getDocumentByRelPath.get(rel) as DocumentRow | undefined
    if (existing) {
      if (existing.mtime !== st.mtimeMs || existing.size_bytes !== st.size) {
        repsil.queries.updateDocumentMtime.run({
          rel_path: rel,
          mtime: st.mtimeMs,
          size_bytes: st.size
        })
        enqueueExtraction(existing.id)
        // Real local change → push to peers. Files written by sync match the
        // stored mtime/size, hit neither branch, and are not re-broadcast.
        emitFileChanged(rel)
      }
    } else {
      const info = repsil.queries.insertDocument.run({
        rel_path: rel,
        filename: basename(rel),
        ext: extOf(rel),
        size_bytes: st.size,
        mtime: st.mtimeMs,
        ctime: st.ctimeMs
      })
      const id = Number(info.lastInsertRowid)
      if (inheritsFolderFlag(repsil, rel, 'ocr_default')) {
        repsil.queries.setOcrRequested.run(id)
      }
      enqueueExtraction(id)
      emitFileChanged(rel)
    }
  }

  watcher.on('add', (p) => void onUpsert(p))
  watcher.on('change', (p) => void onUpsert(p))
  watcher.on('unlink', (p) => {
    const rel = toRel(repsil.rootPath, p)
    if (isIgnoredRel(rel)) return
    const row = repsil.queries.getDocumentByRelPath.get(rel) as DocumentRow | undefined
    if (row) {
      recordDeletion({
        content_hash: row.content_hash,
        size_bytes: row.size_bytes,
        ext: row.ext,
        filename: row.filename,
        title: row.title,
        doc_date: row.doc_date,
        source: row.source,
        notes: row.notes,
        user_edited_fields: row.user_edited_fields
      })
      // Record a tombstone so the delete propagates to peers, and push it live.
      const deletedAt = Date.now()
      repsil.queries.insertTombstone.run({
        rel_path: rel,
        content_hash: row.content_hash,
        deleted_at: deletedAt,
        device: null
      })
      repsil.queries.deleteDocumentByRelPath.run(rel)
      emitDeleted(rel, row.content_hash, deletedAt)
    } else {
      repsil.queries.deleteDocumentByRelPath.run(rel)
    }
  })
  watcher.on('error', (err) => {
    console.error('Watcher error:', err)
  })

  // Periodic full reconcile — catches events the OS may have dropped
  // (antivirus, network drives, OneDrive). Plan: every 10 minutes.
  // drainPending after each one so rows inserted by reconcile (not the live
  // watcher) actually get their text extracted.
  const reconcileTimer = setInterval(() => {
    reconcile(repsil)
      .then(() => {
        drainPending()
      })
      .catch((err) => console.error('Periodic reconcile failed:', err))
  }, 10 * 60 * 1000)

  const handle: WatcherHandle = {
    rootPath: repsil.rootPath,
    stop: async () => {
      await watcher.close()
    }
  }
  active = { handle, reconcileTimer }
  return handle
}

export async function stopWatcher(): Promise<void> {
  if (!active) return
  if (active.reconcileTimer) clearInterval(active.reconcileTimer)
  await active.handle.stop()
  active = null
}

export function getActiveWatcher(): WatcherHandle | null {
  return active?.handle ?? null
}
