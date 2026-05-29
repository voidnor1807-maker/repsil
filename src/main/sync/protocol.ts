import type { ManifestEntry } from '../db/queries'

/** Tombstone shape exchanged on the wire (subset of the DB row). */
export interface WireTombstone {
  rel_path: string
  content_hash: string | null
  deleted_at: number
}

/**
 * Wire protocol for a sync connection. Frames are length-prefixed JSON:
 *
 *   [ uint32 big-endian payload length ][ utf-8 JSON payload ]
 *
 * File bytes ride inside FILE messages as base64. For a LAN document archive
 * (MB-scale files) the simplicity of an all-JSON protocol outweighs the ~33%
 * base64 overhead, and it keeps the codec trivially testable.
 */

/** Curated metadata that travels with a document (not extraction output). */
export interface SyncedMeta {
  title: string | null
  doc_date: string | null
  source: string | null
  notes: string | null
  user_edited_fields: string
  meta_updated_at: number | null
}

export type SyncMessage =
  | { t: 'hello'; deviceId: string; deviceName: string; archiveId: string; empty: boolean }
  | { t: 'bye'; reason: string }
  | { t: 'manifest'; entries: ManifestEntry[]; tombstones: WireTombstone[] }
  | { t: 'need'; files: string[]; metaOnly: string[] }
  | {
      t: 'file'
      rel_path: string
      content_hash: string | null
      size_bytes: number
      mtime: number
      dataB64: string
      meta: SyncedMeta
    }
  | { t: 'meta'; rel_path: string; meta: SyncedMeta }
  | { t: 'tombstone'; rel_path: string; content_hash: string | null; deleted_at: number }
  | { t: 'ping' }

// Cap a single frame so a malformed/hostile length prefix can't trigger a huge
// allocation. Large enough for a base64-encoded multi-MB file chunk.
const MAX_FRAME_BYTES = 32 * 1024 * 1024

export function encodeFrame(msg: SyncMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

export interface FrameDecoder {
  /** Feed bytes; returns any fully-decoded messages. Throws on a bad length. */
  push(chunk: Buffer): SyncMessage[]
}

export function createFrameDecoder(): FrameDecoder {
  let buf: Buffer = Buffer.alloc(0)
  return {
    push(chunk: Buffer): SyncMessage[] {
      buf = Buffer.concat([buf, chunk])
      const out: SyncMessage[] = []
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0)
        if (len > MAX_FRAME_BYTES) {
          throw new Error(`sync frame too large: ${len} bytes`)
        }
        if (buf.length < 4 + len) break
        const payload = buf.subarray(4, 4 + len)
        buf = buf.subarray(4 + len)
        out.push(JSON.parse(payload.toString('utf-8')) as SyncMessage)
      }
      return out
    }
  }
}
