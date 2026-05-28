/**
 * In-memory snapshot of recently-deleted documents. When a "new" file appears
 * that's really a rename, we restore the user-curated metadata.
 *
 * Two match strategies:
 *  1. by content_hash — strongest signal, used once extraction has hashed the
 *     new file.
 *  2. by size_bytes — fallback for files renamed BEFORE they were ever
 *     extracted (no hash yet). Only trusted when the size is unambiguous
 *     (exactly one pending snapshot has it), since many files share sizes.
 *
 * Snapshots expire after 60s — long enough to cover any unlink→add gap, short
 * enough to avoid stale matches.
 */

export interface RenameSnapshot {
  content_hash: string | null
  size_bytes: number
  filename: string
  title: string | null
  doc_date: string | null
  source: string | null
  notes: string | null
  user_edited_fields: string
  deletedAt: number
}

const TTL_MS = 60_000
let snapshots: RenameSnapshot[] = []

export function recordDeletion(s: Omit<RenameSnapshot, 'deletedAt'>): void {
  const hasMetadata =
    s.title !== null ||
    s.doc_date !== null ||
    s.source !== null ||
    s.notes !== null ||
    s.user_edited_fields !== '[]'
  if (!hasMetadata) return
  snapshots.push({ ...s, deletedAt: Date.now() })
}

export function consumeMatch(contentHash: string): RenameSnapshot | null {
  prune()
  const idx = snapshots.findIndex((s) => s.content_hash === contentHash)
  if (idx === -1) return null
  const [hit] = snapshots.splice(idx, 1)
  return hit
}

/** Fallback: match by size only when exactly one snapshot has that size. */
export function consumeMatchBySize(sizeBytes: number): RenameSnapshot | null {
  prune()
  const matches = snapshots.filter((s) => s.size_bytes === sizeBytes)
  if (matches.length !== 1) return null
  const hit = matches[0]
  snapshots = snapshots.filter((s) => s !== hit)
  return hit
}

export function prune(): void {
  const cutoff = Date.now() - TTL_MS
  snapshots = snapshots.filter((s) => s.deletedAt >= cutoff)
}

export function clearAll(): void {
  snapshots = []
}
