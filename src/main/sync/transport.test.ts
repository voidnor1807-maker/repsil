import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { RepsilDb } from '../db'
import { SyncEngine, type EnginePeer } from './engine'
import { connectSecure, createSecureServer, type SecureChannel } from './secureChannel'

/**
 * Minimal stand-in for RepsilDb covering only what SyncEngine touches. We can't
 * load the real better-sqlite3 here (it's compiled for Electron's ABI, not
 * Node), so we fake the handful of query calls.
 */
function fakeRepsil(archiveId: string, empty: boolean): RepsilDb {
  return {
    archiveId,
    rootPath: '/tmp/x',
    dbPath: '/tmp/x/.repsil/repsil.db',
    db: {} as never,
    queries: {
      countDocuments: { get: () => ({ n: empty ? 0 : 5 }) },
      listTombstones: { all: () => [] },
      listForSync: { all: () => [] },
      getFolderSettings: { get: () => undefined },
      upsertPeer: { run: () => undefined }
    } as never
  }
}

const identity = (id: string, name: string) => ({ deviceId: id, deviceName: name })

interface Wired {
  port: number
  close: () => Promise<void>
  hostReady: Promise<EnginePeer>
  hostError: Promise<string>
}

async function host(repsil: RepsilDb, dev = identity('host-dev', 'Host')): Promise<Wired> {
  let onReady!: (p: EnginePeer) => void
  let onError!: (m: string) => void
  const hostReady = new Promise<EnginePeer>((r) => (onReady = r))
  const hostError = new Promise<string>((r) => (onError = r))
  const server = await createSecureServer(PSK, (channel: SecureChannel) => {
    const eng = new SyncEngine(channel, repsil, dev, { onReady, onError })
    eng.start()
  })
  return { port: server.port, close: server.close, hostReady, hostError }
}

const PSK = randomBytes(16)

describe('sync transport + handshake (localhost)', () => {
  it('connects over the encrypted channel and both sides reach ready when archives match', async () => {
    const server = await host(fakeRepsil('same-arc', false))
    const socket = await connectSecure('127.0.0.1', server.port, PSK)

    const clientReady = new Promise<EnginePeer>((resolve) => {
      const eng = new SyncEngine(socket, fakeRepsil('same-arc', false), identity('c1', 'Client'), {
        onReady: resolve
      })
      eng.start()
    })

    const [hostPeer, clientPeer] = await Promise.all([server.hostReady, clientReady])
    expect(hostPeer.deviceName).toBe('Client')
    expect(clientPeer.deviceName).toBe('Host')

    socket.destroy()
    await server.close()
  })

  it('refuses to sync two established archives with different ids', async () => {
    const server = await host(fakeRepsil('archive-A', false))
    const socket = await connectSecure('127.0.0.1', server.port, PSK)

    const clientError = new Promise<string>((resolve) => {
      const eng = new SyncEngine(socket, fakeRepsil('archive-B', false), identity('c2', 'Client'), {
        onError: resolve
      })
      eng.start()
    })

    const msg = await clientError
    expect(msg).toMatch(/different archives/i)

    socket.destroy()
    await server.close()
  })

  it('rejects a connection presenting the wrong PSK', async () => {
    const server = await host(fakeRepsil('same-arc', false))
    await expect(connectSecure('127.0.0.1', server.port, randomBytes(16))).rejects.toBeDefined()
    await server.close()
  })
})
