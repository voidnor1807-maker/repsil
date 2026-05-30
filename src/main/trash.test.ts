import { existsSync, mkdtempSync, promises as fs, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { adoptIncomingTombstone, listTrash, moveToTrash, purgeFromTrash, restoreFromTrash, sweepTrash, trashFileAbs } from './trash'
import type { RepsilDb } from './db'

interface Row {
  id: number
  rel_path: string
  filename: string
  ext: string
  size_bytes: number
  content_hash: string | null
  title: string | null
  doc_date: string | null
  source: string | null
  notes: string | null
  user_edited_fields: string
}

interface Tomb {
  rel_path: string
  content_hash: string | null
  deleted_at: number
  device: string | null
  trash_id: string | null
  filename: string | null
  ext: string | null
  size_bytes: number | null
  deleted_by: string | null
  snap_title: string | null
  snap_doc_date: string | null
  snap_source: string | null
  snap_notes: string | null
  snap_user_edited_fields: string | null
}

/**
 * In-memory stand-in for RepsilDb. Only implements the queries trash.ts uses;
 * the rest of the interface is widened away with `as never` so we don't need
 * the full better-sqlite3 machinery in unit tests.
 */
function stubRepsil(rootPath: string): { repsil: RepsilDb; docs: Map<string, Row>; tombs: Map<string, Tomb> } {
  const docs = new Map<string, Row>()
  const tombs = new Map<string, Tomb>()
  const byTrashId = (id: string): Tomb | undefined => {
    for (const t of tombs.values()) if (t.trash_id === id) return t
    return undefined
  }
  const q = {
    getDocumentByRelPath: { get: (rel: string) => docs.get(rel) },
    deleteDocumentByRelPath: { run: (rel: string) => void docs.delete(rel) },
    insertTombstone: {
      run: (t: Tomb) => {
        const existing = tombs.get(t.rel_path)
        if (existing) {
          // mimic ON CONFLICT … COALESCE merge
          const e = existing as unknown as Record<string, unknown>
          const inc = t as unknown as Record<string, unknown>
          for (const key of Object.keys(inc)) {
            if (key === 'rel_path' || key === 'deleted_at' || key === 'content_hash' || key === 'device') {
              e[key] = inc[key]
            } else if (inc[key] != null) {
              e[key] = inc[key]
            }
          }
        } else {
          tombs.set(t.rel_path, { ...t })
        }
      }
    },
    getTombstone: { get: (rel: string) => tombs.get(rel) },
    deleteTombstone: { run: (rel: string) => void tombs.delete(rel) },
    getTombstoneByTrashId: { get: (id: string) => byTrashId(id) },
    listTrashItems: {
      all: () =>
        [...tombs.values()]
          .filter((t) => t.trash_id && t.filename)
          .sort((a, b) => b.deleted_at - a.deleted_at)
          .map((t) => ({
            trash_id: t.trash_id!,
            rel_path: t.rel_path,
            filename: t.filename!,
            ext: t.ext,
            size_bytes: t.size_bytes,
            deleted_at: t.deleted_at,
            deleted_by: t.deleted_by,
            snap_title: t.snap_title,
            snap_doc_date: t.snap_doc_date,
            snap_source: t.snap_source,
            snap_notes: t.snap_notes
          }))
    },
    listTrashItemsOlderThan: {
      all: (cutoff: number) =>
        [...tombs.values()]
          .filter((t) => t.trash_id && t.filename && t.deleted_at < cutoff)
          .map((t) => ({
            trash_id: t.trash_id!,
            rel_path: t.rel_path,
            filename: t.filename!,
            ext: t.ext,
            size_bytes: t.size_bytes,
            deleted_at: t.deleted_at,
            deleted_by: t.deleted_by,
            snap_title: t.snap_title,
            snap_doc_date: t.snap_doc_date,
            snap_source: t.snap_source,
            snap_notes: t.snap_notes
          }))
    },
    clearTombstoneTrash: {
      run: (rel: string) => {
        const t = tombs.get(rel)
        if (!t) return
        t.trash_id = null
        t.filename = null
        t.ext = null
        t.size_bytes = null
        t.snap_title = null
        t.snap_doc_date = null
        t.snap_source = null
        t.snap_notes = null
        t.snap_user_edited_fields = null
      }
    },
    pruneTombstones: {
      run: (cutoff: number) => {
        for (const [rel, t] of [...tombs.entries()]) {
          if (t.deleted_at < cutoff) tombs.delete(rel)
        }
      }
    }
  }
  return {
    repsil: { rootPath, queries: q } as unknown as RepsilDb,
    docs,
    tombs
  }
}

function makeDoc(rel: string, content = 'data'): Row {
  return {
    id: 1,
    rel_path: rel,
    filename: rel.split('/').pop()!,
    ext: rel.split('.').pop() ?? '',
    size_bytes: Buffer.byteLength(content),
    content_hash: 'h-' + content,
    title: 'My Note',
    doc_date: '2026-05-30',
    source: 'Stub Source',
    notes: 'snap-of-note',
    user_edited_fields: '["title"]'
  }
}

describe('shared trash', () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'repsil-trash-'))
  })
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  test('moveToTrash relocates the file under .repsil/trash/<trash_id>/ and snapshots metadata', async () => {
    const { repsil, docs, tombs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'note.txt'), 'hello')
    docs.set('note.txt', makeDoc('note.txt', 'hello'))

    const result = await moveToTrash(repsil, 'note.txt', 'Laptop-A')

    expect(result).not.toBeNull()
    expect(existsSync(join(workdir, 'note.txt'))).toBe(false)
    expect(existsSync(trashFileAbs(workdir, result!.trashId, 'note.txt'))).toBe(true)
    const tomb = tombs.get('note.txt')!
    expect(tomb.trash_id).toBe(result!.trashId)
    expect(tomb.deleted_by).toBe('Laptop-A')
    expect(tomb.snap_title).toBe('My Note')
    expect(tomb.snap_doc_date).toBe('2026-05-30')
    expect(tomb.snap_user_edited_fields).toBe('["title"]')
    expect(docs.has('note.txt')).toBe(false)
  })

  test('listTrash returns the moved item with its snapshot', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.txt'), 'x')
    docs.set('a.txt', makeDoc('a.txt'))
    await moveToTrash(repsil, 'a.txt', 'me')

    const items = listTrash(repsil)
    expect(items).toHaveLength(1)
    expect(items[0].filename).toBe('a.txt')
    expect(items[0].snap_title).toBe('My Note')
  })

  test('restoreFromTrash returns the file to its original rel_path and drops the tombstone', async () => {
    const { repsil, docs, tombs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.txt'), 'x')
    docs.set('a.txt', makeDoc('a.txt'))
    const r = await moveToTrash(repsil, 'a.txt', null)

    const restoredPath = await restoreFromTrash(repsil, r!.trashId)

    expect(restoredPath).toBe('a.txt')
    expect(existsSync(join(workdir, 'a.txt'))).toBe(true)
    expect(existsSync(trashFileAbs(workdir, r!.trashId, 'a.txt'))).toBe(false)
    expect(tombs.has('a.txt')).toBe(false)
  })

  test('restoreFromTrash avoids overwriting a file that exists at the original path', async () => {
    const { repsil, docs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.txt'), 'orig')
    docs.set('a.txt', makeDoc('a.txt', 'orig'))
    const r = await moveToTrash(repsil, 'a.txt', null)
    // A new file with the same name appeared while the original was trashed.
    writeFileSync(join(workdir, 'a.txt'), 'newer')

    const restored = await restoreFromTrash(repsil, r!.trashId)

    expect(restored).toBe('a (restored 1).txt')
    expect(existsSync(join(workdir, 'a.txt'))).toBe(true)
    expect(existsSync(join(workdir, 'a (restored 1).txt'))).toBe(true)
  })

  test('purgeFromTrash deletes the file but keeps the tombstone for sync propagation', async () => {
    const { repsil, docs, tombs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'a.txt'), 'x')
    docs.set('a.txt', makeDoc('a.txt'))
    const r = await moveToTrash(repsil, 'a.txt', null)

    const ok = await purgeFromTrash(repsil, r!.trashId)

    expect(ok).toBe(true)
    expect(existsSync(trashFileAbs(workdir, r!.trashId, 'a.txt'))).toBe(false)
    const tomb = tombs.get('a.txt')!
    expect(tomb.trash_id).toBeNull()
    expect(tomb.filename).toBeNull()
  })

  test('adoptIncomingTombstone with bytes locally: moves our copy to our trash', async () => {
    const { repsil, docs, tombs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'doc.pdf'), 'BYTES')
    docs.set('doc.pdf', makeDoc('doc.pdf', 'BYTES'))

    await adoptIncomingTombstone(repsil, {
      rel_path: 'doc.pdf',
      content_hash: 'h-BYTES',
      deleted_at: 100,
      trash_id: 'remote-trash-id',
      filename: 'doc.pdf',
      ext: 'pdf',
      size_bytes: 5,
      deleted_by: 'Peer-B',
      snap_title: 'Remote Title',
      snap_doc_date: null,
      snap_source: null,
      snap_notes: null,
      snap_user_edited_fields: '[]'
    })

    expect(existsSync(join(workdir, 'doc.pdf'))).toBe(false)
    expect(existsSync(trashFileAbs(workdir, 'remote-trash-id', 'doc.pdf'))).toBe(true)
    const tomb = tombs.get('doc.pdf')!
    expect(tomb.snap_title).toBe('Remote Title')
    expect(tomb.deleted_by).toBe('Peer-B')
  })

  test('adoptIncomingTombstone without local bytes records the tombstone but no trash file', async () => {
    const { repsil, tombs } = stubRepsil(workdir)

    await adoptIncomingTombstone(repsil, {
      rel_path: 'never-had-this.pdf',
      content_hash: null,
      deleted_at: 100,
      trash_id: 'remote-id',
      filename: 'never-had-this.pdf',
      ext: 'pdf',
      size_bytes: 5,
      deleted_by: 'Peer-B',
      snap_title: 'X',
      snap_doc_date: null,
      snap_source: null,
      snap_notes: null,
      snap_user_edited_fields: null
    })

    expect(existsSync(trashFileAbs(workdir, 'remote-id', 'never-had-this.pdf'))).toBe(false)
    const tomb = tombs.get('never-had-this.pdf')!
    // trash_id is cleared because we have no bytes to restore from.
    expect(tomb.trash_id).toBeNull()
    expect(tomb.snap_title).toBe('X')
  })

  test('sweepTrash purges files past the retention window and clears the row pointers', async () => {
    const { repsil, docs, tombs } = stubRepsil(workdir)
    writeFileSync(join(workdir, 'old.txt'), 'x')
    docs.set('old.txt', makeDoc('old.txt'))
    const r = await moveToTrash(repsil, 'old.txt', null)
    // Reach into the tombstone and pretend it was deleted long ago.
    tombs.get('old.txt')!.deleted_at = Date.now() - 100 * 24 * 60 * 60 * 1000

    const swept = await sweepTrash(repsil, 30 * 24 * 60 * 60 * 1000)

    expect(swept.purged).toBe(1)
    expect(existsSync(trashFileAbs(workdir, r!.trashId, 'old.txt'))).toBe(false)
    // pruneTombstones runs at the end of sweepTrash, so the row is fully GC'd.
    expect(tombs.has('old.txt')).toBe(false)
  })

  test('moveToTrash on a non-existent rel_path is a no-op (returns null)', async () => {
    const { repsil } = stubRepsil(workdir)
    const r = await moveToTrash(repsil, 'nothing.pdf', null)
    expect(r).toBeNull()
  })
})

// Cleanup any leftover fs writes the stub created outside the workdir
afterEach(async () => {
  await fs.rm(join(tmpdir(), 'repsil-trash-leftover'), { recursive: true, force: true })
})
