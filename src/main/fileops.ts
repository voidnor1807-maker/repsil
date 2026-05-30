import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { RepsilDb } from './db'
import { resolveInsideArchive } from './pathSafety'

export interface ImportResult {
  imported: string[]
  skipped: Array<{ source: string; reason: string }>
}

/**
 * Copy a list of external absolute paths into the archive under destFolderRel.
 * Returns the relative paths of imported files plus a per-file skip reason for
 * anything that failed. Filename collisions auto-rename to `name (1).ext`,
 * `name (2).ext`, ... so a drop never silently overwrites an existing file.
 *
 * Directories and oversize files are skipped. The watcher picks the new files
 * up as `add` events and the existing extraction/sync pipelines take over.
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

  for (const source of sources) {
    try {
      const st = await fs.stat(source)
      if (st.isDirectory()) {
        result.skipped.push({ source, reason: 'directories not supported yet' })
        continue
      }
      if (!st.isFile()) {
        result.skipped.push({ source, reason: 'not a regular file' })
        continue
      }
      if (st.size > maxBytes) {
        result.skipped.push({ source, reason: `file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB cap` })
        continue
      }
      const original = basename(source)
      const targetName = await chooseTargetName(destDirAbs, original)
      const targetAbs = join(destDirAbs, targetName)
      // copyFile + COPYFILE_EXCL means we still fail rather than overwrite if
      // another process raced us between chooseTargetName and now.
      await fs.copyFile(source, targetAbs, fs.constants.COPYFILE_EXCL)
      const relPath = folder ? `${folder}/${targetName}` : targetName
      result.imported.push(relPath)
    } catch (err) {
      result.skipped.push({ source, reason: (err as Error).message })
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
