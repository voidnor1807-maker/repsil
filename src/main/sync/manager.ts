import { randomBytes } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import type { SyncPeer, SyncProgress, SyncRole, SyncStatus } from '@shared/types'
import { getDb } from '../db'
import { decodeJoinCode, encodeJoinCode } from './code'
import { SyncEngine } from './engine'
import { getIdentity } from './identity'
import { lanAddress } from './netinfo'
import { connectPsk, createPskServer, type PskServer } from './tls'

/**
 * Process-wide sync state. Star topology: a device either hosts (a PSK server
 * accepting many joiners) or has joined one host. The manager owns the engines
 * and exposes a single SyncStatus the IPC layer relays to the renderer.
 */
let role: SyncRole = 'idle'
let code: string | null = null
let error: string | null = null
let server: PskServer | null = null
let clientSocket: TLSSocket | null = null
const engines = new Set<SyncEngine>()
const peers = new Map<string, SyncPeer>()
let progress: SyncProgress = { pending: 0, done: 0 }
let notify: (() => void) | null = null

export function onSyncChange(cb: () => void): void {
  notify = cb
}

function changed(): void {
  notify?.()
}

export function syncStatus(): SyncStatus {
  return { role, code, peers: [...peers.values()], progress, error }
}

function attachEngine(socket: TLSSocket): SyncEngine {
  const repsil = getDb()
  if (!repsil) throw new Error('No archive open')
  const identity = getIdentity()
  const engine = new SyncEngine(socket, repsil, identity, {
    onReady: (peer) => {
      peers.set(peer.deviceId, {
        deviceId: peer.deviceId,
        name: peer.deviceName,
        connected: true,
        lastSeen: Date.now()
      })
      error = null
      changed()
    },
    onError: (m) => {
      error = m
      changed()
    },
    onClose: (peer) => {
      engines.delete(engine)
      if (peer) {
        const p = peers.get(peer.deviceId)
        if (p) {
          p.connected = false
          p.lastSeen = Date.now()
        }
      }
      changed()
    },
    onApplied: (msg) => {
      // Star relay: a change applied from one peer is forwarded to the other
      // connected peers (the host is the only node with >1 engine, so joiners
      // never relay — preventing broadcast loops).
      for (const other of engines) {
        if (other !== engine) other.send(msg)
      }
    }
  })
  engines.add(engine)
  engine.start()
  return engine
}

export async function startHosting(): Promise<{ code: string }> {
  const repsil = getDb()
  if (!repsil) throw new Error('Open an archive before hosting')
  await stopSync()

  const psk = randomBytes(16)
  server = await createPskServer(psk, (socket) => {
    try {
      attachEngine(socket)
    } catch {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
  })
  code = encodeJoinCode({ host: lanAddress(), port: server.port, psk })
  role = 'hosting'
  error = null
  changed()
  return { code }
}

export async function joinSession(rawCode: string): Promise<void> {
  const repsil = getDb()
  if (!repsil) throw new Error('Open an archive before joining')
  const target = decodeJoinCode(rawCode.trim())
  if (!target) throw new Error('That code is invalid or corrupted')

  await stopSync()
  const socket = await connectPsk(target.host, target.port, target.psk)
  clientSocket = socket
  role = 'joined'
  error = null
  attachEngine(socket)
  changed()
}

export async function stopSync(): Promise<void> {
  for (const e of engines) e.close()
  engines.clear()
  if (server) {
    await server.close()
    server = null
  }
  if (clientSocket) {
    try {
      clientSocket.destroy()
    } catch {
      /* ignore */
    }
    clientSocket = null
  }
  peers.clear()
  role = 'idle'
  code = null
  progress = { pending: 0, done: 0 }
  changed()
}
