import { mkdtempSync, promises as fs, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { importExternalFiles } from './fileops'
import type { RepsilDb } from './db'

// Minimal RepsilDb stub — fileops only reads rootPath, so we don't need an
// actual database. Casting through unknown keeps TypeScript honest.
function stubRepsil(rootPath: string): RepsilDb {
  return { rootPath } as unknown as RepsilDb
}

describe('importExternalFiles', () => {
  let workdir: string
  let archiveRoot: string
  let outside: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-fileops-'))
    archiveRoot = join(workdir, 'archive')
    outside = join(workdir, 'outside')
    writeFileSync(join(workdir, '.placeholder'), '')
  })
  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
  })

  test('copies a single file into the archive root', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'a.pdf'), 'hello')

    const r = await importExternalFiles(stubRepsil(archiveRoot), [join(outside, 'a.pdf')], '')

    expect(r.imported).toEqual(['a.pdf'])
    expect(r.skipped).toEqual([])
    expect(await fs.readFile(join(archiveRoot, 'a.pdf'), 'utf-8')).toBe('hello')
  })

  test('writes into a subfolder, creating it if needed', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'b.txt'), 'x')

    const r = await importExternalFiles(stubRepsil(archiveRoot), [join(outside, 'b.txt')], 'subfolder/deep')

    expect(r.imported).toEqual(['subfolder/deep/b.txt'])
    expect(await fs.stat(join(archiveRoot, 'subfolder', 'deep', 'b.txt'))).toBeDefined()
  })

  test('avoids overwriting an existing file by appending (1), (2)…', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    await fs.writeFile(join(archiveRoot, 'doc.pdf'), 'EXISTING')
    await fs.writeFile(join(outside, 'doc.pdf'), 'IMPORTED')

    const r = await importExternalFiles(stubRepsil(archiveRoot), [join(outside, 'doc.pdf')], '')

    expect(r.imported).toEqual(['doc (1).pdf'])
    expect(await fs.readFile(join(archiveRoot, 'doc.pdf'), 'utf-8')).toBe('EXISTING')
    expect(await fs.readFile(join(archiveRoot, 'doc (1).pdf'), 'utf-8')).toBe('IMPORTED')
  })

  test('rejects a destination folder that escapes the root', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'a'), '')

    const r = await importExternalFiles(stubRepsil(archiveRoot), [join(outside, 'a')], '../etc')

    expect(r.imported).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].reason).toMatch(/invalid destination/i)
  })

  test('skips oversize files but processes the rest', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    await fs.writeFile(join(outside, 'big.bin'), Buffer.alloc(2048))
    await fs.writeFile(join(outside, 'ok.txt'), 'fine')

    const r = await importExternalFiles(
      stubRepsil(archiveRoot),
      [join(outside, 'big.bin'), join(outside, 'ok.txt')],
      '',
      { maxBytes: 1024 }
    )

    expect(r.imported).toEqual(['ok.txt'])
    expect(r.skipped.map((s) => s.reason)).toEqual(
      expect.arrayContaining([expect.stringMatching(/cap/i)])
    )
  })

  test('imports a dropped folder recursively, preserving its tree', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    const src = join(outside, 'New folder (2)')
    await fs.mkdir(src)
    await fs.mkdir(join(src, 'nested'))
    await fs.writeFile(join(src, 'a.txt'), 'A')
    await fs.writeFile(join(src, 'nested', 'b.txt'), 'B')

    const r = await importExternalFiles(stubRepsil(archiveRoot), [src], '')

    expect(r.skipped).toEqual([])
    expect(r.imported.sort()).toEqual([
      'New folder (2)/a.txt',
      'New folder (2)/nested/b.txt'
    ])
    expect(await fs.readFile(join(archiveRoot, 'New folder (2)', 'a.txt'), 'utf-8')).toBe('A')
    expect(
      await fs.readFile(join(archiveRoot, 'New folder (2)', 'nested', 'b.txt'), 'utf-8')
    ).toBe('B')
  })

  test('reports an empty folder drop instead of silently doing nothing', async () => {
    await fs.mkdir(archiveRoot)
    await fs.mkdir(outside)
    const src = join(outside, 'empty')
    await fs.mkdir(src)

    const r = await importExternalFiles(stubRepsil(archiveRoot), [src], '')

    expect(r.imported).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].reason).toMatch(/empty/i)
  })
})
