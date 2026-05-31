import { existsSync, mkdtempSync, promises as fs, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { copyDocument, createFolder, moveDocument, renameDocument } from './fileops'
import type { RepsilDb } from './db'

interface Row {
  rel_path: string
  filename: string
  ext: string
}

/**
 * Stub repsil for the rename/move ops. Only documents are touched here, so
 * we just need getDocumentByRelPath + renameDocumentByRelPath. The watcher
 * isn't running, so suppression has no observable effect in this test.
 */
function stubRepsil(rootPath: string): { repsil: RepsilDb; docs: Map<string, Row> } {
  const docs = new Map<string, Row>()
  const q = {
    getDocumentByRelPath: { get: (rel: string) => docs.get(rel) },
    renameDocumentByRelPath: {
      run: (d: { old_rel_path: string; new_rel_path: string; filename: string; ext: string }) => {
        const row = docs.get(d.old_rel_path)
        if (!row) return
        docs.delete(d.old_rel_path)
        docs.set(d.new_rel_path, { rel_path: d.new_rel_path, filename: d.filename, ext: d.ext })
      }
    }
  }
  return {
    repsil: { rootPath, queries: q } as unknown as RepsilDb,
    docs
  }
}

describe('renameDocument', () => {
  let workdir: string
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-fileops-rename-'))
  })
  afterEach(() => rmSync(workdir, { recursive: true, force: true }))

  test('renames the file on disk and updates the row in place', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'old.pdf'), 'x')
    docs.set('old.pdf', { rel_path: 'old.pdf', filename: 'old.pdf', ext: 'pdf' })

    const r = await renameDocument(repsil, 'old.pdf', 'new-name.pdf')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('new-name.pdf')
    expect(existsSync(join(workdir, 'old.pdf'))).toBe(false)
    expect(existsSync(join(workdir, 'new-name.pdf'))).toBe(true)
    expect(docs.has('old.pdf')).toBe(false)
    expect(docs.get('new-name.pdf')).toMatchObject({ filename: 'new-name.pdf', ext: 'pdf' })
  })

  test('rejects a path-y new name (must be a plain filename)', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.pdf'), 'x')
    docs.set('a.pdf', { rel_path: 'a.pdf', filename: 'a.pdf', ext: 'pdf' })

    const r = await renameDocument(repsil, 'a.pdf', '../escape.pdf')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/invalid filename/i)
    expect(existsSync(join(workdir, 'a.pdf'))).toBe(true)
  })

  test('refuses to overwrite an existing destination', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.pdf'), '1')
    writeFileSync(join(workdir, 'b.pdf'), '2')
    docs.set('a.pdf', { rel_path: 'a.pdf', filename: 'a.pdf', ext: 'pdf' })
    docs.set('b.pdf', { rel_path: 'b.pdf', filename: 'b.pdf', ext: 'pdf' })

    const r = await renameDocument(repsil, 'a.pdf', 'b.pdf')

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already exists/i)
    expect(await fs.readFile(join(workdir, 'a.pdf'), 'utf-8')).toBe('1')
    expect(await fs.readFile(join(workdir, 'b.pdf'), 'utf-8')).toBe('2')
  })
})

describe('moveDocument', () => {
  let workdir: string
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-fileops-move-'))
  })
  afterEach(() => rmSync(workdir, { recursive: true, force: true }))

  test('moves a file into a subfolder, creating it if absent', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'note.txt'), 'x')
    docs.set('note.txt', { rel_path: 'note.txt', filename: 'note.txt', ext: 'txt' })

    const r = await moveDocument(repsil, 'note.txt', 'inbox/2026')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('inbox/2026/note.txt')
    expect(existsSync(join(workdir, 'inbox', '2026', 'note.txt'))).toBe(true)
    expect(existsSync(join(workdir, 'note.txt'))).toBe(false)
    expect(docs.get('inbox/2026/note.txt')).toBeDefined()
  })

  test('auto-suffixes filename on collision in the destination folder', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    await fs.mkdir(join(workdir, 'archive'))
    writeFileSync(join(workdir, 'archive', 'note.txt'), 'existing')
    writeFileSync(join(workdir, 'note.txt'), 'incoming')
    docs.set('note.txt', { rel_path: 'note.txt', filename: 'note.txt', ext: 'txt' })

    const r = await moveDocument(repsil, 'note.txt', 'archive')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('archive/note (1).txt')
    expect(await fs.readFile(join(workdir, 'archive', 'note.txt'), 'utf-8')).toBe('existing')
    expect(await fs.readFile(join(workdir, 'archive', 'note (1).txt'), 'utf-8')).toBe('incoming')
  })

  test('rejects a destination folder that escapes the archive', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'note.txt'), 'x')
    docs.set('note.txt', { rel_path: 'note.txt', filename: 'note.txt', ext: 'txt' })

    const r = await moveDocument(repsil, 'note.txt', '../etc')

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/invalid/i)
  })

  test('no-op when moving to the folder the file already lives in', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    await fs.mkdir(join(workdir, 'sub'))
    writeFileSync(join(workdir, 'sub', 'a.pdf'), 'x')
    docs.set('sub/a.pdf', { rel_path: 'sub/a.pdf', filename: 'a.pdf', ext: 'pdf' })

    const r = await moveDocument(repsil, 'sub/a.pdf', 'sub')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('sub/a.pdf')
    expect(existsSync(join(workdir, 'sub', 'a.pdf'))).toBe(true)
  })
})

describe('copyDocument', () => {
  let workdir: string
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-fileops-copy-'))
  })
  afterEach(() => rmSync(workdir, { recursive: true, force: true }))

  test('copies a file into a destination folder, leaving the source intact', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'note.txt'), 'hello')
    docs.set('note.txt', { rel_path: 'note.txt', filename: 'note.txt', ext: 'txt' })

    const r = await copyDocument(repsil, 'note.txt', 'inbox')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('inbox/note.txt')
    expect(existsSync(join(workdir, 'note.txt'))).toBe(true)
    expect(existsSync(join(workdir, 'inbox', 'note.txt'))).toBe(true)
    expect(await fs.readFile(join(workdir, 'inbox', 'note.txt'), 'utf-8')).toBe('hello')
  })

  test('auto-suffixes on filename collision in the destination', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    await fs.mkdir(join(workdir, 'inbox'))
    writeFileSync(join(workdir, 'inbox', 'note.txt'), 'existing')
    writeFileSync(join(workdir, 'note.txt'), 'fresh')
    docs.set('note.txt', { rel_path: 'note.txt', filename: 'note.txt', ext: 'txt' })

    const r = await copyDocument(repsil, 'note.txt', 'inbox')

    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('inbox/note (1).txt')
    expect(await fs.readFile(join(workdir, 'inbox', 'note.txt'), 'utf-8')).toBe('existing')
    expect(await fs.readFile(join(workdir, 'inbox', 'note (1).txt'), 'utf-8')).toBe('fresh')
  })
})

describe('createFolder', () => {
  let workdir: string
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-fileops-mkfolder-'))
  })
  afterEach(() => rmSync(workdir, { recursive: true, force: true }))

  test('creates a folder under the given parent', async () => {
    const { repsil } = stubRepsil(workdir)
    const r = await createFolder(repsil, '', 'Drafts')
    expect(r.ok).toBe(true)
    expect(r.newRelPath).toBe('Drafts')
    expect(existsSync(join(workdir, 'Drafts'))).toBe(true)
  })

  test('errors when the folder already exists', async () => {
    const { repsil } = stubRepsil(workdir)
    await fs.mkdir(join(workdir, 'Drafts'))
    const r = await createFolder(repsil, '', 'Drafts')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already exists/i)
  })

  test('rejects names with a separator', async () => {
    const { repsil } = stubRepsil(workdir)
    const r = await createFolder(repsil, '', 'foo/bar')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/invalid/i)
  })
})
