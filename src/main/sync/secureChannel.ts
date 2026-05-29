import { EventEmitter } from 'node:events'
import net from 'node:net'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Encrypted transport over plain TCP. We can't use TLS-PSK because Electron is
 * built against BoringSSL, which rejects PSK cipher suites (NO_CIPHER_MATCH) —
 * even though they work under plain Node/OpenSSL. So we do the encryption at the
 * application layer with Node `crypto` (AES-256-GCM + HKDF), which BoringSSL
 * fully supports. No external dependencies.
 *
 * Handshake (plaintext): each side sends a random 16-byte salt. Both derive the
 * same AES key = HKDF(psk, sortedSalts). Each side then sends an encrypted auth
 * token; verifying the peer's token proves it holds the same code (implicit
 * mutual auth — a wrong code yields a different key and the GCM tag fails). Once
 * both auth tokens verify, the channel emits `ready` and carries length-prefixed
 * AES-GCM records, each wrapping one plaintext frame.
 */
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const AUTH_TOKEN = Buffer.from('repsil-sync-auth-v1')
const MAX_RECORD = 32 * 1024 * 1024

function deriveKey(psk: Buffer, a: Buffer, b: Buffer): Buffer {
  const [s1, s2] = [a, b].sort(Buffer.compare)
  return Buffer.from(hkdfSync('sha256', psk, Buffer.concat([s1, s2]), AUTH_TOKEN, KEY_LEN))
}

export class SecureChannel extends EventEmitter {
  private key: Buffer | null = null
  private readonly localSalt = randomBytes(SALT_LEN)
  private buf: Buffer = Buffer.alloc(0)
  private state: 'salt' | 'auth' | 'open' = 'salt'
  private closed = false
  // Decrypted frames that arrived before a 'data' listener was attached. The
  // consumer (engine) subscribes asynchronously after connectSecure resolves,
  // so a HELLO coalesced with the auth record must not be dropped.
  private dataQueue: Buffer[] = []

  constructor(
    private socket: net.Socket,
    private psk: Buffer
  ) {
    super()
    this.on('newListener', (event) => {
      if (event === 'data' && this.dataQueue.length > 0) {
        const queued = this.dataQueue
        this.dataQueue = []
        // Defer so the listener being added is registered before we emit.
        queueMicrotask(() => {
          for (const b of queued) this.emit('data', b)
        })
      }
    })
    socket.on('data', (d: Buffer) => this.onRaw(d))
    socket.on('error', (e: Error) => this.fail(e.message))
    socket.on('close', () => this.onClose())
    socket.write(this.localSalt) // begin the plaintext handshake
  }

  private deliver(frame: Buffer): void {
    if (this.listenerCount('data') > 0) this.emit('data', frame)
    else this.dataQueue.push(frame)
  }

  /** Encrypt one plaintext frame and send it as a length-prefixed record. */
  write(plaintext: Buffer): void {
    if (this.closed || !this.key) return
    const iv = randomBytes(IV_LEN)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const record = Buffer.concat([iv, ct, tag])
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(record.length, 0)
    try {
      this.socket.write(Buffer.concat([header, record]))
    } catch {
      /* socket closing */
    }
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
  }

  private onRaw(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    try {
      this.drain()
    } catch (err) {
      this.fail((err as Error).message)
    }
  }

  private drain(): void {
    if (this.state === 'salt') {
      if (this.buf.length < SALT_LEN) return
      const remoteSalt = this.buf.subarray(0, SALT_LEN)
      this.buf = this.buf.subarray(SALT_LEN)
      this.key = deriveKey(this.psk, this.localSalt, remoteSalt)
      this.state = 'auth'
      this.write(AUTH_TOKEN) // send our encrypted auth token
    }

    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (len > MAX_RECORD) throw new Error('record too large')
      if (this.buf.length < 4 + len) break
      const record = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      const plaintext = this.decrypt(record)

      if (this.state === 'auth') {
        if (plaintext.length !== AUTH_TOKEN.length || !timingSafeEqual(plaintext, AUTH_TOKEN)) {
          throw new Error('authentication failed')
        }
        this.state = 'open'
        this.emit('ready')
      } else {
        this.deliver(plaintext)
      }
    }
  }

  private decrypt(record: Buffer): Buffer {
    if (!this.key) throw new Error('no key')
    const iv = record.subarray(0, IV_LEN)
    const tag = record.subarray(record.length - TAG_LEN)
    const ct = record.subarray(IV_LEN, record.length - TAG_LEN)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()])
  }

  private fail(message: string): void {
    if (this.closed) return
    this.emit('error', new Error(message))
    this.destroy()
  }

  private onClose(): void {
    if (!this.closed) this.closed = true
    this.emit('close')
  }
}

export interface SecureServer {
  port: number
  close: () => Promise<void>
}

/** Bind a TCP server; hand each authenticated SecureChannel to onConn. */
export function createSecureServer(
  psk: Buffer,
  onConn: (channel: SecureChannel) => void
): Promise<SecureServer> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const channel = new SecureChannel(socket, psk)
      channel.once('ready', () => onConn(channel))
      channel.once('error', () => channel.destroy())
    })
    server.once('error', reject)
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res())
          })
      })
    })
  })
}

/** Connect and authenticate. Resolves once the channel is ready (auth passed). */
export function connectSecure(host: string, port: number, psk: Buffer): Promise<SecureChannel> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    socket.once('error', reject)
    const channel = new SecureChannel(socket, psk)
    let settled = false
    channel.once('ready', () => {
      settled = true
      resolve(channel)
    })
    channel.once('error', (err) => {
      if (!settled) reject(err)
    })
    channel.once('close', () => {
      if (!settled) reject(new Error('connection closed before authentication'))
    })
  })
}
