import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decodeJoinCode, encodeJoinCode } from './code'

describe('join code', () => {
  const sample = { host: '192.168.1.42', port: 51820, psk: randomBytes(16) }

  it('round-trips host, port, and psk', () => {
    const code = encodeJoinCode(sample)
    const decoded = decodeJoinCode(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.host).toBe(sample.host)
    expect(decoded!.port).toBe(sample.port)
    expect(decoded!.psk.equals(sample.psk)).toBe(true)
  })

  it('produces a copy-paste-safe string (no whitespace)', () => {
    const code = encodeJoinCode(sample)
    expect(code).not.toMatch(/\s/)
    expect(code.length).toBeGreaterThan(0)
  })

  it('rejects a tampered checksum', () => {
    const code = encodeJoinCode(sample)
    const tampered = code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a')
    expect(decodeJoinCode(tampered)).toBeNull()
  })

  it('rejects truncated / garbage input', () => {
    expect(decodeJoinCode('')).toBeNull()
    expect(decodeJoinCode('not-a-code')).toBeNull()
    expect(decodeJoinCode('a.b.c.d')).toBeNull()
    expect(decodeJoinCode('🙂')).toBeNull()
  })

  it('rejects an out-of-range port', () => {
    const bad = encodeJoinCode({ ...sample, port: 70000 })
    // encode does not validate, but decode must
    expect(decodeJoinCode(bad)).toBeNull()
  })
})
