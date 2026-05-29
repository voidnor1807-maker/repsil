import { describe, expect, it } from 'vitest'
import { createFrameDecoder, encodeFrame, type SyncMessage } from './protocol'

const hello: SyncMessage = {
  t: 'hello',
  deviceId: 'dev-1',
  deviceName: 'Laptop',
  archiveId: 'arc-1',
  empty: false
}

describe('frame codec', () => {
  it('round-trips a single message', () => {
    const dec = createFrameDecoder()
    const out = dec.push(encodeFrame(hello))
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(hello)
  })

  it('decodes multiple frames delivered in one chunk', () => {
    const dec = createFrameDecoder()
    const buf = Buffer.concat([encodeFrame(hello), encodeFrame({ t: 'ping' })])
    const out = dec.push(buf)
    expect(out.map((m) => m.t)).toEqual(['hello', 'ping'])
  })

  it('reassembles a frame split across chunk boundaries', () => {
    const dec = createFrameDecoder()
    const frame = encodeFrame(hello)
    const a = frame.subarray(0, 3) // mid-length-prefix
    const b = frame.subarray(3, 10)
    const c = frame.subarray(10)
    expect(dec.push(a)).toHaveLength(0)
    expect(dec.push(b)).toHaveLength(0)
    const out = dec.push(c)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(hello)
  })

  it('buffers a partial trailing frame until completed', () => {
    const dec = createFrameDecoder()
    const two = Buffer.concat([encodeFrame({ t: 'ping' }), encodeFrame(hello)])
    const first = dec.push(two.subarray(0, two.length - 5))
    expect(first.map((m) => m.t)).toEqual(['ping'])
    const rest = dec.push(two.subarray(two.length - 5))
    expect(rest.map((m) => m.t)).toEqual(['hello'])
  })

  it('rejects an absurd frame length', () => {
    const dec = createFrameDecoder()
    const bad = Buffer.alloc(4)
    bad.writeUInt32BE(0x7fffffff, 0)
    expect(() => dec.push(bad)).toThrow()
  })
})
