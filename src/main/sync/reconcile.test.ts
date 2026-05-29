import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RepsilDb } from '../db'
import { SyncEngine } from './engine'
import { emitFileChanged } from './bus'
import { connectPsk, createPskServer } from './tls'
import { randomBytes } from 'node:crypto'

interface Row {
  id: number
  rel_path: string
  filename: string
  ext: string
  size_bytes: number
  mtime: number
  ctime: number
  content_hash: string | null
  title: string | null
  doc_date: string | null
  source: string | null
  notes: string | null
  user_edited_fields: string
  meta_updated_at: number | null
}

/** A fake archive: real temp dir on disk + in-memory doc/tombstone maps. */
class FakeArchive {
  rootPath: string
  docs = new Map<string, Row>()
  tombs = new Map<string, { rel_path: string; content_hash: string | null; deleted_at: number }>()
  tags = new Map<string, number>()
  links: { document_id: number; tag_id: number }[] = []
  private nextId = 1
  private nextTagId = 1

  constructor(
    public archiveId: string,
    dirs: string[]
  ) {
    this.rootPath = mkdtempSync(join(tmpdir(), 'repsil-sync-'))
    dirs.push(this.rootPath)
  }

  addFile(rel: string, content: string, row: Partial<Row> = {}): void {
    writeFileSync(join(this.rootPath, rel), content)
    this.docs.set(rel, {
      id: this.nextId++,
      rel_path: rel,
      filename: rel,
      ext: rel.split('.').pop() ?? '',
      size_bytes: Buffer.byteLength(content),
      mtime: 1000,
      ctime: 1000,
      content_hash: 'hash-' + content,
      title: null,
      doc_date: null,
      source: null,
      notes: null,
      user_edited_fields: '[]',
      meta_updated_at: null,
      ...row
    })
  }

  asRepsil(): RepsilDb {
    const q = {
      listForSync: {
        all: () =>
          [...this.docs.values()].map((r) => ({
            rel_path: r.rel_path,
            content_hash: r.content_hash,
            size_bytes: r.size_bytes,
            mtime: r.mtime,
            meta_updated_at: r.meta_updated_at
          }))
      },
      listTombstones: { all: () => [...this.tombs.values()] },
      getFolderSettings: { get: () => undefined },
      countDocuments: { get: () => ({ n: this.docs.size }) },
      upsertPeer: { run: () => undefined },
      getDocumentByRelPath: { get: (rel: string) => this.docs.get(rel) },
      insertDocument: {
        run: (d: Row) => {
          this.docs.set(d.rel_path, {
            id: this.nextId++,
            rel_path: d.rel_path,
            filename: d.filename,
            ext: d.ext,
            size_bytes: d.size_bytes,
            mtime: d.mtime,
            ctime: d.ctime,
            content_hash: null,
            title: null,
            doc_date: null,
            source: null,
            notes: null,
            user_edited_fields: '[]',
            meta_updated_at: null
          })
        }
      },
      updateDocumentMtime: {
        run: (d: { rel_path: string; mtime: number; size_bytes: number }) => {
          const r = this.docs.get(d.rel_path)
          if (r) {
            r.mtime = d.mtime
            r.size_bytes = d.size_bytes
          }
        }
      },
      upsertSyncedMetadata: {
        run: (d: Row) => {
          const r = this.docs.get(d.rel_path)
          if (r) {
            r.title = d.title
            r.doc_date = d.doc_date
            r.source = d.source
            r.notes = d.notes
            r.user_edited_fields = d.user_edited_fields
            r.meta_updated_at = d.meta_updated_at
          }
        }
      },
      deleteDocumentByRelPath: { run: (rel: string) => void this.docs.delete(rel) },
      insertTombstone: {
        run: (t: { rel_path: string; content_hash: string | null; deleted_at: number }) =>
          void this.tombs.set(t.rel_path, t)
      },
      upsertTag: {
        get: (name: string) => {
          let id = this.tags.get(name)
          if (id === undefined) {
            id = this.nextTagId++
            this.tags.set(name, id)
          }
          return { id }
        }
      },
      linkTag: {
        run: (l: { document_id: number; tag_id: number }) => void this.links.push(l)
      }
    }
    return { rootPath: this.rootPath, dbPath: '', db: {} as never, archiveId: this.archiveId, queries: q as never }
  }
}

const PSK = randomBytes(16)
const tempDirs: string[] = []

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (pred()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('one-shot reconcile (localhost)', () => {
  it('transfers a file + curated metadata from host to an empty joiner', async () => {
    const hostArc = new FakeArchive('arc-shared', tempDirs)
    hostArc.addFile('note.txt', 'hello world', {
      title: 'My Note',
      user_edited_fields: '["title"]',
      meta_updated_at: 500
    })
    const clientArc = new FakeArchive('arc-shared', tempDirs)

    const server = await createPskServer(PSK, (socket) => {
      new SyncEngine(socket, hostArc.asRepsil(), { deviceId: 'h', deviceName: 'Host' }).start()
    })
    const socket = await connectPsk('127.0.0.1', server.port, PSK)
    new SyncEngine(socket, clientArc.asRepsil(), { deviceId: 'c', deviceName: 'Client' }).start()

    await waitFor(() => existsSync(join(clientArc.rootPath, 'note.txt')) && clientArc.docs.has('note.txt'))

    expect(readFileSync(join(clientArc.rootPath, 'note.txt'), 'utf-8')).toBe('hello world')
    expect(clientArc.docs.get('note.txt')?.title).toBe('My Note')

    socket.destroy()
    await server.close()
  })

  it('propagates a delete from the host tombstone to the joiner', async () => {
    const hostArc = new FakeArchive('arc-shared', tempDirs)
    hostArc.tombs.set('old.txt', { rel_path: 'old.txt', content_hash: 'h', deleted_at: 9999 })

    const clientArc = new FakeArchive('arc-shared', tempDirs)
    // joiner still has the file (older mtime) that the host deleted
    mkdirSync(clientArc.rootPath, { recursive: true })
    clientArc.addFile('old.txt', 'stale', { mtime: 100 })

    const server = await createPskServer(PSK, (socket) => {
      new SyncEngine(socket, hostArc.asRepsil(), { deviceId: 'h', deviceName: 'Host' }).start()
    })
    const socket = await connectPsk('127.0.0.1', server.port, PSK)
    new SyncEngine(socket, clientArc.asRepsil(), { deviceId: 'c', deviceName: 'Client' }).start()

    await waitFor(() => !existsSync(join(clientArc.rootPath, 'old.txt')) && !clientArc.docs.has('old.txt'))
    expect(clientArc.docs.has('old.txt')).toBe(false)

    socket.destroy()
    await server.close()
  })
})

describe('continuous live sync (localhost)', () => {
  it('pushes a new local file to a connected peer in real time', async () => {
    const hostArc = new FakeArchive('arc-shared', tempDirs)
    const clientArc = new FakeArchive('arc-shared', tempDirs)

    let hostReady!: () => void
    let clientReady!: () => void
    const ready = Promise.all([
      new Promise<void>((r) => (hostReady = r)),
      new Promise<void>((r) => (clientReady = r))
    ])

    const server = await createPskServer(PSK, (socket) => {
      new SyncEngine(socket, hostArc.asRepsil(), { deviceId: 'h', deviceName: 'Host' }, {
        onReady: () => hostReady()
      }).start()
    })
    const socket = await connectPsk('127.0.0.1', server.port, PSK)
    new SyncEngine(socket, clientArc.asRepsil(), { deviceId: 'c', deviceName: 'Client' }, {
      onReady: () => clientReady()
    }).start()

    await ready

    // A new file appears locally on the host after the connection is live.
    hostArc.addFile('live.txt', 'fresh', { content_hash: 'hash-fresh' })
    emitFileChanged('live.txt')

    await waitFor(
      () => existsSync(join(clientArc.rootPath, 'live.txt')) && clientArc.docs.has('live.txt')
    )
    expect(readFileSync(join(clientArc.rootPath, 'live.txt'), 'utf-8')).toBe('fresh')

    socket.destroy()
    await server.close()
  })
})

describe('conflict preservation (localhost)', () => {
  it('keeps the losing copy as a conflict-tagged sibling, winner stays canonical', async () => {
    const hostArc = new FakeArchive('arc-shared', tempDirs)
    hostArc.addFile('doc.txt', 'host wins', { content_hash: 'hash-host', mtime: 20 })

    const clientArc = new FakeArchive('arc-shared', tempDirs)
    clientArc.addFile('doc.txt', 'client loses', { content_hash: 'hash-client', mtime: 10 })

    const server = await createPskServer(PSK, (socket) => {
      new SyncEngine(socket, hostArc.asRepsil(), { deviceId: 'h', deviceName: 'Host' }).start()
    })
    const socket = await connectPsk('127.0.0.1', server.port, PSK)
    new SyncEngine(socket, clientArc.asRepsil(), { deviceId: 'c', deviceName: 'Client' }).start()

    // Wait until the client has taken the winner AND created a conflict sibling.
    await waitFor(() => {
      const canonical = existsSync(join(clientArc.rootPath, 'doc.txt'))
        ? readFileSync(join(clientArc.rootPath, 'doc.txt'), 'utf-8')
        : ''
      const sibling = [...clientArc.docs.keys()].find((k) => /\.conflict-/.test(k))
      return canonical === 'host wins' && sibling !== undefined
    })

    const siblingPath = [...clientArc.docs.keys()].find((k) => /\.conflict-/.test(k))!
    expect(readFileSync(join(clientArc.rootPath, siblingPath), 'utf-8')).toBe('client loses')
    // the sibling was tagged 'conflict'
    const conflictTagId = clientArc.tags.get('conflict')
    expect(conflictTagId).toBeDefined()
    expect(clientArc.links.some((l) => l.tag_id === conflictTagId)).toBe(true)

    socket.destroy()
    await server.close()
  })
})
