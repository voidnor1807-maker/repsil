import type { RepsilDb } from '../db'
import type { ManifestEntry, TombstoneRow } from '../db/queries'
import { inheritsFolderFlag } from '../folders'

export interface ManifestTombstone {
  rel_path: string
  content_hash: string | null
  deleted_at: number
}

export interface Manifest {
  entries: ManifestEntry[]
  tombstones: ManifestTombstone[]
}

/**
 * What the LOCAL side should do after comparing manifests. Each peer computes
 * its own plan from its own perspective and pulls what it lacks; pushes happen
 * implicitly because the other side pulls from us.
 */
export interface SyncPlan {
  /** rel_paths to request full file bytes (+ metadata) for. */
  pullFiles: string[]
  /** rel_paths where content matches but the remote's metadata is newer. */
  pullMeta: string[]
  /** Files to delete locally because the remote deleted them more recently. */
  deleteLocal: ManifestTombstone[]
}

/** Build this archive's manifest, excluding local-only folders (never synced). */
export function buildManifest(repsil: RepsilDb): Manifest {
  const all = repsil.queries.listForSync.all() as ManifestEntry[]
  const entries = all.filter((e) => !inheritsFolderFlag(repsil, e.rel_path, 'local_only'))
  const tombstones = (repsil.queries.listTombstones.all() as TombstoneRow[]).map((t) => ({
    rel_path: t.rel_path,
    content_hash: t.content_hash,
    deleted_at: t.deleted_at
  }))
  return { entries, tombstones }
}

/**
 * Compare local vs remote manifests and decide what the local side needs.
 * Pure — the heart of the reconcile, exhaustively unit-tested.
 *
 * Conflict policy here is plain last-writer-wins by mtime (newer content wins).
 * Stage 4 layers conflict *preservation* on top of this (keep the loser, tagged).
 */
export function diffManifests(local: Manifest, remote: Manifest): SyncPlan {
  const localByPath = new Map(local.entries.map((e) => [e.rel_path, e]))
  const localTomb = new Map(local.tombstones.map((t) => [t.rel_path, t.deleted_at]))

  const pullFiles: string[] = []
  const pullMeta: string[] = []
  const deleteLocal: ManifestTombstone[] = []

  for (const r of remote.entries) {
    // We deleted this file more recently than the remote's copy → don't pull;
    // the remote will delete it when it sees our tombstone.
    const tombAt = localTomb.get(r.rel_path)
    if (tombAt !== undefined && tombAt > r.mtime) continue

    const l = localByPath.get(r.rel_path)
    if (!l) {
      pullFiles.push(r.rel_path)
    } else if (l.content_hash !== r.content_hash) {
      // Content differs: newer mtime wins. If ours is newer we keep it and the
      // remote pulls from us.
      if (r.mtime > l.mtime) pullFiles.push(r.rel_path)
    } else if ((r.meta_updated_at ?? 0) > (l.meta_updated_at ?? 0)) {
      // Same content, remote curated it more recently → take just the metadata.
      pullMeta.push(r.rel_path)
    }
  }

  for (const rt of remote.tombstones) {
    const l = localByPath.get(rt.rel_path)
    if (l && rt.deleted_at > l.mtime) deleteLocal.push(rt)
  }

  return { pullFiles, pullMeta, deleteLocal }
}
