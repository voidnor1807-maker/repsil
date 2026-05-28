/**
 * In-memory snapshot of recently-deleted documents. When a "new" file appears
 * that's really a rename, we restore the user-curated metadata.
 *
 * Two match strategies:
 *  1. by content_hash — strongest signal, used once extraction has hashed the
 *     new file.
 *  2. by size_bytes + ext — fallback for files renamed BEFORE they were ever
 *     extracted (no hash yet). Only trusted when (size, ext) is unambiguous
 *     (exactly one pending snapshot has it), since many files share a size.
 *     Requiring the extension to match too sharply cuts false positives where
 *     two unrelated files merely happen to share a byte count (WR-04).
 *
 * Snapshots expire after 60s — long enough to cover any unlink→add gap, short
 * enough to avoid stale matches.
 */

export interface RenameSnapshot {
  content_hash: string | null
  size_bytes: number
  ext: string
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

/**
 * Fallback: match by (size, ext) only when exactly one snapshot has that pair.
 * Requiring the extension to match avoids attaching one document's curated
 * metadata to an unrelated same-size file (WR-04).
 */
export function consumeMatchBySize(sizeBytes: number, ext: string): RenameSnapshot | null {
  prune()
  const matches = snapshots.filter((s) => s.size_bytes === sizeBytes && s.ext === ext)
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
