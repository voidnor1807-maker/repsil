import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { RepsilDb } from './db'
import { isIgnoredRel, toRel } from './watcher/paths'

export interface FolderNode {
  rel_path: string
  name: string
  children: FolderNode[]
  ocr_default: boolean
  local_only: boolean
}

/**
 * Walk the archive root and produce a folder tree, annotated with per-folder
 * settings. The root itself is represented as `{ rel_path: '', name: '' }`.
 */
export async function buildFolderTree(repsil: RepsilDb): Promise<FolderNode> {
  const settingsRows = repsil.queries.listAllFolderSettings.all() as {
    rel_path: string
    ocr_default: 0 | 1
    local_only: 0 | 1
  }[]
  const settings = new Map(settingsRows.map((r) => [r.rel_path, r]))

  const root: FolderNode = {
    rel_path: '',
    name: '',
    children: [],
    ocr_default: settings.get('')?.ocr_default === 1,
    local_only: settings.get('')?.local_only === 1
  }

  await walk(repsil.rootPath, repsil.rootPath, root, settings)
  return root
}

async function walk(
  root: string,
  dir: string,
  node: FolderNode,
  settings: Map<string, { ocr_default: 0 | 1; local_only: 0 | 1 }>
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const abs = join(dir, entry.name)
    const rel = toRel(root, abs)
    if (isIgnoredRel(rel)) continue
    const s = settings.get(rel)
    const child: FolderNode = {
      rel_path: rel,
      name: basename(rel),
      children: [],
      ocr_default: s?.ocr_default === 1,
      local_only: s?.local_only === 1
    }
    node.children.push(child)
    await walk(root, abs, child, settings)
  }
  node.children.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Walks ancestors of `fileRelPath` looking for ANY folder with the given
 * setting key set to 1. Used for inherited OCR default.
 */
export function inheritsFolderFlag(
  repsil: RepsilDb,
  fileRelPath: string,
  flag: 'ocr_default' | 'local_only'
): boolean {
  const parts = fileRelPath.split('/').slice(0, -1)
  // Check progressively-longer ancestor paths, plus the root ('')
  const candidates = ['']
  let acc = ''
  for (const p of parts) {
    acc = acc === '' ? p : `${acc}/${p}`
    candidates.push(acc)
  }
  for (const rel of candidates) {
    const row = repsil.queries.getFolderSettings.get(rel)
    if (row && row[flag] === 1) return true
  }
  return false
}
