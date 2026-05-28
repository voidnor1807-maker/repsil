import { relative, sep } from 'node:path'

/**
 * Normalize a relative path to forward slashes (matches schema's rel_path).
 */
export function toRel(rootPath: string, absPath: string): string {
  const rel = relative(rootPath, absPath)
  return sep === '\\' ? rel.split('\\').join('/') : rel
}

/**
 * Lowercase extension without the dot. '' for no extension.
 */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i <= 0 || i === filename.length - 1) return ''
  return filename.slice(i + 1).toLowerCase()
}

/**
 * Anything under .repsil/ is ours and must be ignored by the watcher
 * AND skipped by reconcile. Also skip OS noise.
 */
export function isIgnoredRel(rel: string): boolean {
  if (!rel || rel === '.' || rel === '..') return true
  if (rel.startsWith('.repsil/') || rel === '.repsil') return true
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  if (base === 'Thumbs.db' || base === 'desktop.ini' || base === '.DS_Store') return true
  return false
}
