/**
 * Decides whether two archives are allowed to sync, enforcing "sync only with
 * the matching open directory". Both peers run this with mirrored inputs and
 * arrive at consistent verdicts:
 *
 *  - sync          ids already match → proceed
 *  - adopt-remote  I'm a pristine archive → take the remote's id and become its replica
 *  - remote-adopts the remote is pristine → it adopts mine; I keep my id and proceed
 *  - refuse        two established, different archives → never merge them
 */
export type ArchiveVerdict = 'sync' | 'adopt-remote' | 'remote-adopts' | 'refuse'

export interface ArchiveSide {
  id: string
  /** Pristine: no documents and no tombstones — safe to adopt another identity. */
  empty: boolean
}

export function evaluateArchiveMatch(local: ArchiveSide, remote: ArchiveSide): ArchiveVerdict {
  if (local.id === remote.id) return 'sync'
  if (local.empty && !remote.empty) return 'adopt-remote'
  if (!local.empty && remote.empty) return 'remote-adopts'
  if (local.empty && remote.empty) {
    // Both pristine but with different ids: deterministic tiebreak so the two
    // sides agree on who keeps their id.
    return local.id < remote.id ? 'remote-adopts' : 'adopt-remote'
  }
  return 'refuse'
}

export const ARCHIVE_MISMATCH_MESSAGE =
  'These are different archives — sync aborted to avoid merging unrelated collections.'
