import { createHash } from 'node:crypto'

/**
 * The connection details a host shares with joiners, packed into a single
 * copy/paste string. The psk both encrypts the channel (TLS-PSK) and proves the
 * joiner was given the code, so the code is effectively a one-session password.
 */
export interface JoinTarget {
  host: string
  port: number
  psk: Buffer
}

const VERSION = 1

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function checksum(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

/** Pack a target into `<base64url(payload)>.<checksum>`. */
export function encodeJoinCode(target: JoinTarget): string {
  const payload = JSON.stringify({
    v: VERSION,
    h: target.host,
    p: target.port,
    k: b64url(target.psk)
  })
  const body = b64url(Buffer.from(payload, 'utf-8'))
  return `${body}.${checksum(body)}`
}

/** Parse + validate a code. Returns null for anything malformed or tampered. */
export function decodeJoinCode(code: string): JoinTarget | null {
  if (typeof code !== 'string') return null
  const trimmed = code.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return null

  const body = trimmed.slice(0, dot)
  const sum = trimmed.slice(dot + 1)
  if (sum !== checksum(body)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const obj = parsed as Record<string, unknown>
  if (obj.v !== VERSION) return null
  if (typeof obj.h !== 'string' || obj.h.length === 0) return null
  if (typeof obj.p !== 'number' || !Number.isInteger(obj.p) || obj.p < 1 || obj.p > 65535) {
    return null
  }
  if (typeof obj.k !== 'string') return null

  const psk = Buffer.from(obj.k, 'base64url')
  if (psk.length === 0) return null

  return { host: obj.h, port: obj.p, psk }
}
