import { EventEmitter } from 'node:events'

/**
 * In-process change bus. The watcher and metadata IPC handlers emit LOCAL
 * changes here; active SyncEngines subscribe and push the corresponding deltas
 * to their peer. This is the "continuous" mechanism on top of the one-shot
 * reconcile.
 *
 * Loop safety is structural rather than flag-based: the sync apply layer never
 * emits here, and the watcher only emits on a *real* change (it no-ops when it
 * sees a row whose mtime/size already match a sync-written file), so changes
 * arriving from a peer are not re-broadcast.
 */
const emitter = new EventEmitter()
emitter.setMaxListeners(100)

export function emitFileChanged(relPath: string): void {
  emitter.emit('file', relPath)
}
export function emitMetaChanged(relPath: string): void {
  emitter.emit('meta', relPath)
}
export function emitDeleted(relPath: string, contentHash: string | null, deletedAt: number): void {
  emitter.emit('del', relPath, contentHash, deletedAt)
}

export function onFileChanged(cb: (relPath: string) => void): () => void {
  emitter.on('file', cb)
  return () => emitter.off('file', cb)
}
export function onMetaChanged(cb: (relPath: string) => void): () => void {
  emitter.on('meta', cb)
  return () => emitter.off('meta', cb)
}
export function onDeleted(
  cb: (relPath: string, contentHash: string | null, deletedAt: number) => void
): () => void {
  emitter.on('del', cb)
  return () => emitter.off('del', cb)
}
