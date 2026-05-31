import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { RepsilDb } from './db'
import type { DocumentRow } from './db/queries'
import { resolveInsideArchive } from './pathSafety'
import { emitFileChanged } from './sync/bus'
import { extOf } from './watcher/paths'

/**
 * In-app file ops (rename / move / create folder) bypass the watcher to avoid
 * a delete+insert dance that would wipe the documents row's id (and along with
 * it tags, extracted_text, content_hash). We suppress chokidar events for the
 * source + destination paths for a short window after the op so the watcher
 * skips its insert/tombstone logic; the DB row is updated in-place instead.
 */
const SUPPRESS_MS = 5000
const suppressed = new Map<string, number>()

export function suppressEvent(absPath: string): void {
  suppressed.set(absPath, Date.now() + SUPPRESS_MS)
}
export function isEventSuppressed(absPath: string): boolean {
  const exp = suppressed.get(absPath)
  if (exp == null) return false
  if (Date.now() > exp) {
    suppressed.delete(absPath)
    return false
  }
  return true
}
export function clearSuppression(absPath: string): void {
  suppressed.delete(absPath)
}

export interface ImportResult {
  imported: string[]
  skipped: Array<{ source: string; reason: string }>
}

interface WorkItem {
  srcAbs: string
  /** Path inside the destination folder, with forward slashes. The basename of
   *  this is what we run through the per-folder collision suffix logic; the
   *  rest of the segments are created with `mkdir -p` semantics. */
  destSubPath: string
  size: number
}

/** Recursively collect every regular file inside `dir`. Returns absolute paths
 *  paired with the path inside `dir` (forward-slashed). Symlinks are ignored
 *  to avoid loops and accidental archive-escape via a symlinked folder drop. */
async function walkDirectory(
  dir: string,
  baseRelInDir: string
): Promise<Array<{ abs: string; relInDir: string }>> {
  const out: Array<{ abs: string; relInDir: string }> = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    const childRel = baseRelInDir ? `${baseRelInDir}/${e.name}` : e.name
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      const nested = await walkDirectory(full, childRel)
      out.push(...nested)
    } else if (e.isFile()) {
      out.push({ abs: full, relInDir: childRel })
    }
  }
  return out
}

/**
 * Copy a list of external absolute paths into the archive under destFolderRel.
 * Returns the relative paths of imported files plus a per-file skip reason for
 * anything that failed. Filename collisions auto-rename to `name (1).ext`,
 * `name (2).ext`, ... so a drop never silently overwrites an existing file.
 *
 * Directories are walked recursively: their tree is mirrored under
 * `destFolderRel/<directoryName>/...`. Per-file collisions inside the mirrored
 * tree get the same `(1)`, `(2)` suffix. Oversize files (per-file cap) are
 * skipped individually. The watcher picks new files up as `add` events and
 * the existing extraction/sync pipelines take over.
 */
export async function importExternalFiles(
  repsil: RepsilDb,
  sources: string[],
  destFolderRel: string,
  opts: { maxBytes?: number } = {}
): Promise<ImportResult> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024 * 1024 // 1 GB default cap
  const result: ImportResult = { imported: [], skipped: [] }

  // Normalize the destination so 'sub/' and 'sub' behave the same. Empty string
  // = archive root.
  const folder = destFolderRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const destDirAbs = folder ? resolveInsideArchive(repsil.rootPath, folder) : repsil.rootPath
  if (!destDirAbs) {
    for (const s of sources) result.skipped.push({ source: s, reason: 'invalid destination folder' })
    return result
  }
  try {
    await fs.mkdir(destDirAbs, { recursive: true })
  } catch (err) {
    for (const s of sources) result.skipped.push({ source: s, reason: `mkdir failed: ${(err as Error).message}` })
    return result
  }

  // First pass: expand directories into a flat list of work items. This lets
  // a single error inside a giant tree skip just that file and keep going.
  const items: WorkItem[] = []
  for (const source of sources) {
    try {
      const st = await fs.stat(source)
      if (st.isDirectory()) {
        const topName = basename(source)
        const walked = await walkDirectory(source, '')
        if (walked.length === 0) {
          // Nothing to import from the dropped folder. Surface it so the user
          // isn't left wondering whether the drop registered.
          result.skipped.push({ source, reason: 'folder is empty' })
          continue
        }
        for (const w of walked) {
          try {
            const sub = await fs.stat(w.abs)
            items.push({
              srcAbs: w.abs,
              destSubPath: `${topName}/${w.relInDir}`,
              size: sub.size
            })
          } catch (err) {
            result.skipped.push({ source: w.abs, reason: (err as Error).message })
          }
        }
      } else if (st.isFile()) {
        items.push({ srcAbs: source, destSubPath: basename(source), size: st.size })
      } else {
        result.skipped.push({ source, reason: 'not a regular file' })
      }
    } catch (err) {
      result.skipped.push({ source, reason: (err as Error).message })
    }
  }

  for (const item of items) {
    if (item.size > maxBytes) {
      result.skipped.push({
        source: item.srcAbs,
        reason: `file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB cap`
      })
      continue
    }
    try {
      // Build the final target relative to the archive root and resolve it
      // back through the safety check so a maliciously crafted directory name
      // (e.g. one containing '..') can never escape the archive.
      const finalRel = folder ? `${folder}/${item.destSubPath}` : item.destSubPath
      const parentRel = dirname(finalRel).replace(/\\/g, '/')
      const targetParentAbs =
        parentRel === '.' ? repsil.rootPath : resolveInsideArchive(repsil.rootPath, parentRel)
      if (!targetParentAbs) {
        result.skipped.push({ source: item.srcAbs, reason: 'invalid destination' })
        continue
      }
      await fs.mkdir(targetParentAbs, { recursive: true })
      const original = basename(finalRel)
      const targetName = await chooseTargetName(targetParentAbs, original)
      const targetAbs = join(targetParentAbs, targetName)
      // copyFile + COPYFILE_EXCL means we still fail rather than overwrite if
      // another process raced us between chooseTargetName and now.
      await fs.copyFile(item.srcAbs, targetAbs, fs.constants.COPYFILE_EXCL)
      const importedRel = parentRel === '.' ? targetName : `${parentRel}/${targetName}`
      result.imported.push(importedRel)
    } catch (err) {
      result.skipped.push({ source: item.srcAbs, reason: (err as Error).message })
    }
  }
  return result
}

async function chooseTargetName(destDirAbs: string, originalName: string): Promise<string> {
  if (!(await pathExists(join(destDirAbs, originalName)))) return originalName
  const ext = extname(originalName)
  const stem = originalName.slice(0, originalName.length - ext.length)
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!(await pathExists(join(destDirAbs, candidate)))) return candidate
  }
  // Pathologically full directory; fall back to a timestamp.
  return `${stem} (${Date.now()})${ext}`
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

/** Result shape shared by rename + move so the renderer can show a single
 *  success/failure path without distinguishing the two cases. */
export interface FileOpResult {
  ok: boolean
  newRelPath?: string
  error?: string
}

function withinParent(parentRel: string, rel: string): string {
  // Normalize trailing slashes. parentRel="" means archive root.
  const parent = parentRel.replace(/\/+$/, '')
  return parent ? `${parent}/${rel}` : rel
}

/** Rename a single document. Keeps the document row id (and all extraction
 *  state) intact; refuses if the destination already exists. */
export async function renameDocument(
  repsil: RepsilDb,
  relPath: string,
  newName: string
): Promise<FileOpResult> {
  // Reject any path-y new name — must be a plain filename.
  if (!newName || newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
    return { ok: false, error: 'invalid filename' }
  }
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return { ok: false, error: 'no such file' }
  const srcAbs = resolveInsideArchive(repsil.rootPath, relPath)
  if (!srcAbs) return { ok: false, error: 'invalid source' }

  const dir = dirname(relPath)
  const newRel = dir === '.' ? newName : `${dir}/${newName}`
  if (newRel === relPath) return { ok: true, newRelPath: relPath }
  const destAbs = resolveInsideArchive(repsil.rootPath, newRel)
  if (!destAbs) return { ok: false, error: 'invalid destination' }
  if (await pathExists(destAbs)) return { ok: false, error: 'destination already exists' }

  suppressEvent(srcAbs)
  suppressEvent(destAbs)
  try {
    await fs.rename(srcAbs, destAbs)
  } catch (err) {
    clearSuppression(srcAbs)
    clearSuppression(destAbs)
    return { ok: false, error: (err as Error).message }
  }

  repsil.queries.renameDocumentByRelPath.run({
    old_rel_path: relPath,
    new_rel_path: newRel,
    filename: newName,
    ext: extOf(newRel)
  })

  // Tell the renderer the path moved. The watcher will see two events but the
  // suppression list makes them no-ops, and the DB row was already updated.
  emitFileChanged(newRel)
  return { ok: true, newRelPath: newRel }
}

/** Move a document into a different folder. Filename stays the same; on a
 *  collision in the destination we auto-suffix " (1)" etc. (matches import). */
export async function moveDocument(
  repsil: RepsilDb,
  relPath: string,
  destFolderRel: string
): Promise<FileOpResult> {
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return { ok: false, error: 'no such file' }
  const srcAbs = resolveInsideArchive(repsil.rootPath, relPath)
  if (!srcAbs) return { ok: false, error: 'invalid source' }

  const folder = destFolderRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const destDirAbs = folder ? resolveInsideArchive(repsil.rootPath, folder) : repsil.rootPath
  if (!destDirAbs) return { ok: false, error: 'invalid destination folder' }

  // No-op if the file is already in the requested folder.
  const currentParent = dirname(relPath)
  const wantParent = folder === '' ? '.' : folder
  if (currentParent === wantParent) return { ok: true, newRelPath: relPath }

  try {
    await fs.mkdir(destDirAbs, { recursive: true })
  } catch (err) {
    return { ok: false, error: `mkdir failed: ${(err as Error).message}` }
  }

  const original = row.filename
  const targetName = await chooseTargetName(destDirAbs, original)
  const newRel = withinParent(folder, targetName)
  const destAbs = join(destDirAbs, targetName)

  suppressEvent(srcAbs)
  suppressEvent(destAbs)
  try {
    await fs.rename(srcAbs, destAbs)
  } catch (err) {
    clearSuppression(srcAbs)
    clearSuppression(destAbs)
    return { ok: false, error: (err as Error).message }
  }

  repsil.queries.renameDocumentByRelPath.run({
    old_rel_path: relPath,
    new_rel_path: newRel,
    filename: targetName,
    ext: extOf(newRel)
  })
  emitFileChanged(newRel)
  return { ok: true, newRelPath: newRel }
}

/** Copy a document into a different folder. Unlike move, no event suppression
 *  is needed: the destination is a brand-new file as far as the watcher is
 *  concerned, so its add handler does the DB insert + extraction naturally.
 *  Filename collisions auto-suffix the same way as import. */
export async function copyDocument(
  repsil: RepsilDb,
  relPath: string,
  destFolderRel: string
): Promise<FileOpResult> {
  const row = repsil.queries.getDocumentByRelPath.get(relPath) as DocumentRow | undefined
  if (!row) return { ok: false, error: 'no such file' }
  const srcAbs = resolveInsideArchive(repsil.rootPath, relPath)
  if (!srcAbs) return { ok: false, error: 'invalid source' }

  const folder = destFolderRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const destDirAbs = folder ? resolveInsideArchive(repsil.rootPath, folder) : repsil.rootPath
  if (!destDirAbs) return { ok: false, error: 'invalid destination folder' }

  try {
    await fs.mkdir(destDirAbs, { recursive: true })
  } catch (err) {
    return { ok: false, error: `mkdir failed: ${(err as Error).message}` }
  }
  const targetName = await chooseTargetName(destDirAbs, row.filename)
  const newRel = withinParent(folder, targetName)
  const destAbs = join(destDirAbs, targetName)
  try {
    await fs.copyFile(srcAbs, destAbs, fs.constants.COPYFILE_EXCL)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  return { ok: true, newRelPath: newRel }
}

/** Create an empty folder under parentRel. Folder names are validated to be a
 *  single segment (no separators). No watcher suppression needed — chokidar
 *  doesn't track folders themselves, only file events inside them. */
export async function createFolder(
  repsil: RepsilDb,
  parentRel: string,
  name: string
): Promise<FileOpResult> {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return { ok: false, error: 'invalid folder name' }
  }
  const parent = parentRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const newRel = parent ? `${parent}/${name}` : name
  const abs = resolveInsideArchive(repsil.rootPath, newRel)
  if (!abs) return { ok: false, error: 'invalid path' }
  try {
    await fs.mkdir(abs, { recursive: false })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EEXIST') return { ok: false, error: 'folder already exists' }
    return { ok: false, error: e.message }
  }
  // Trigger a folder-tree refresh; emitFileChanged is the bus event the IPC
  // layer broadcasts as documents:changed, which the renderer reuses to
  // reload the tree.
  emitFileChanged(newRel)
  return { ok: true, newRelPath: newRel }
}
