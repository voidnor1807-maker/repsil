import { isAbsolute, join, normalize, relative } from 'node:path'

/**
 * Lexically resolve a renderer-supplied relative path against the archive root.
 * Returns the absolute path ONLY if it provably stays inside the root; returns
 * null for traversal, absolute, UNC, drive-letter, or null-byte input.
 *
 * This is a lexical guard — it does not follow symlinks. Callers that actually
 * read the file (e.g. the repsil-file:// handler) MUST additionally verify the
 * real, symlink-resolved path is still inside the root.
 */
export function resolveInsideArchive(root: string, relPath: unknown): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0) return null
  if (relPath.includes('\0')) return null

  // Unify separators so the checks behave identically on every platform, then
  // drop any leading slashes so the value is unambiguously relative.
  const unified = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (unified.length === 0) return null

  // Reject Windows drive letters (C:\...) and any explicit parent segment.
  if (/^[a-zA-Z]:/.test(unified)) return null
  if (/(^|\/)\.\.(\/|$)/.test(unified)) return null

  const abs = normalize(join(root, unified))
  const inside = relative(root, abs)
  // Empty means it resolved to the root itself (not a file); reject.
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null

  return abs
}
