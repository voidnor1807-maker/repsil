import type { SecureChannel } from './secureChannel'
import type { RepsilDb } from '../db'
import { setArchiveId } from '../db'
import { enqueueExtraction } from '../extraction/queue'
import {
  applyIncomingFile,
  applyIncomingMeta,
  applyTombstone,
  metaMessageFor,
  preserveConflict,
  readForSync
} from './apply'
import { onDeleted, onFileChanged, onMetaChanged } from './bus'
import { ARCHIVE_MISMATCH_MESSAGE, evaluateArchiveMatch } from './guard'
import type { DeviceIdentity } from './identity'
import { buildManifest, diffManifests } from './manifest'
import { createFrameDecoder, encodeFrame, type SyncMessage } from './protocol'

export interface EnginePeer {
  deviceId: string
  deviceName: string
}

export interface EngineCallbacks {
  /** Handshake + archive-match succeeded; the connection is now syncing. */
  onReady?: (peer: EnginePeer) => void
  /** Fatal problem (protocol error, archive mismatch, socket error). */
  onError?: (message: string) => void
  /** Socket closed for any reason. */
  onClose?: (peer: EnginePeer | null) => void
  /** A delta from this peer was applied locally — used for host relay. */
  onApplied?: (msg: SyncMessage) => void
}

/**
 * Drives one sync connection. Stage 1 implements the HELLO handshake and the
 * archive-match guard; later stages extend `handle()` with manifest exchange,
 * file/metadata transfer, and live deltas.
 */
export class SyncEngine {
  private dec = createFrameDecoder()
  private peer: EnginePeer | null = null
  private ready = false
  private closed = false
  private unsubs: (() => void)[] = []

  constructor(
    private socket: SecureChannel,
    private repsil: RepsilDb,
    private identity: DeviceIdentity,
    private cb: EngineCallbacks = {}
  ) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('error', (err: Error) => this.fail(`connection error: ${err.message}`))
    socket.on('close', () => this.handleClose())
  }

  /** Send our HELLO. Call once the socket is secure. */
  start(): void {
    this.send({
      t: 'hello',
      deviceId: this.identity.deviceId,
      deviceName: this.identity.deviceName,
      archiveId: this.repsil.archiveId,
      empty: this.isEmpty()
    })
  }

  send(msg: SyncMessage): void {
    if (this.closed) return
    try {
      this.socket.write(encodeFrame(msg))
    } catch {
      // socket is tearing down; close handler will fire
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeLocalChanges()
    try {
      this.socket.destroy()
    } catch {
      /* ignore */
    }
  }

  private onData(chunk: Buffer): void {
    let msgs: SyncMessage[]
    try {
      msgs = this.dec.push(chunk)
    } catch (err) {
      this.fail(`protocol error: ${(err as Error).message}`)
      return
    }
    for (const m of msgs) this.handle(m)
  }

  private handle(msg: SyncMessage): void {
    switch (msg.t) {
      case 'hello':
        this.onHello(msg)
        break
      case 'bye':
        this.fail(msg.reason)
        break
      case 'manifest':
        this.onManifest(msg)
        break
      case 'need':
        void this.onNeed(msg)
        break
      case 'file':
        void applyIncomingFile(this.repsil, msg, enqueueExtraction)
          .then(() => this.cb.onApplied?.(msg))
          .catch((err) => console.error('sync: applyIncomingFile failed:', err))
        break
      case 'meta':
        applyIncomingMeta(this.repsil, msg.rel_path, msg.meta)
        this.cb.onApplied?.(msg)
        break
      case 'tombstone':
        void applyTombstone(this.repsil, {
          rel_path: msg.rel_path,
          content_hash: msg.content_hash,
          deleted_at: msg.deleted_at,
          trash_id: msg.trash_id,
          filename: msg.filename,
          ext: msg.ext,
          size_bytes: msg.size_bytes,
          deleted_by: msg.deleted_by,
          snap_title: msg.snap_title,
          snap_doc_date: msg.snap_doc_date,
          snap_source: msg.snap_source,
          snap_notes: msg.snap_notes,
          snap_user_edited_fields: msg.snap_user_edited_fields
        })
          .then(() => this.cb.onApplied?.(msg))
          .catch((err) => console.error('sync: applyTombstone failed:', err))
        break
      case 'ping':
        break
    }
  }

  private onHello(msg: Extract<SyncMessage, { t: 'hello' }>): void {
    this.peer = { deviceId: msg.deviceId, deviceName: msg.deviceName }

    const verdict = evaluateArchiveMatch(
      { id: this.repsil.archiveId, empty: this.isEmpty() },
      { id: msg.archiveId, empty: msg.empty }
    )

    if (verdict === 'refuse') {
      this.send({ t: 'bye', reason: ARCHIVE_MISMATCH_MESSAGE })
      this.fail(ARCHIVE_MISMATCH_MESSAGE)
      return
    }
    if (verdict === 'adopt-remote') {
      setArchiveId(msg.archiveId)
    }
    // 'remote-adopts' and 'sync': keep our id and proceed.

    if (!this.ready) {
      this.ready = true
      this.repsil.queries.upsertPeer.run({
        device_id: msg.deviceId,
        name: msg.deviceName,
        last_seen: Date.now()
      })
      this.cb.onReady?.(this.peer)
      this.beginReconcile()
      this.subscribeLocalChanges()
    }
  }

  /** Push local edits to this peer as they happen (continuous sync). */
  private subscribeLocalChanges(): void {
    this.unsubs.push(
      onFileChanged((rel) => {
        void readForSync(this.repsil, rel).then((m) => {
          if (m) this.send(m)
        })
      }),
      onMetaChanged((rel) => {
        const m = metaMessageFor(this.repsil, rel)
        if (m) this.send(m)
      }),
      onDeleted((rel) => {
        // Look up the (just-inserted) tombstone row so the wire message carries
        // the full shared-trash bundle when present. Falls back to a bare
        // tombstone if the row vanished (peer can still apply the deletion).
        const tomb = this.repsil.queries.getTombstone.get(rel)
        if (!tomb) return
        this.send({
          t: 'tombstone',
          rel_path: tomb.rel_path,
          content_hash: tomb.content_hash,
          deleted_at: tomb.deleted_at,
          trash_id: tomb.trash_id,
          filename: tomb.filename,
          ext: tomb.ext,
          size_bytes: tomb.size_bytes,
          deleted_by: tomb.deleted_by,
          snap_title: tomb.snap_title,
          snap_doc_date: tomb.snap_doc_date,
          snap_source: tomb.snap_source,
          snap_notes: tomb.snap_notes,
          snap_user_edited_fields: tomb.snap_user_edited_fields
        })
      })
    )
  }

  private unsubscribeLocalChanges(): void {
    for (const off of this.unsubs.splice(0)) off()
  }

  /** Kick off the initial reconcile by advertising our manifest. */
  private beginReconcile(): void {
    const man = buildManifest(this.repsil)
    this.send({ t: 'manifest', entries: man.entries, tombstones: man.tombstones })
  }

  private onManifest(msg: Extract<SyncMessage, { t: 'manifest' }>): void {
    const local = buildManifest(this.repsil)
    const plan = diffManifests(local, { entries: msg.entries, tombstones: msg.tombstones })

    for (const d of plan.deleteLocal) {
      void applyTombstone(this.repsil, d).catch((err) =>
        console.error('sync: delete-local failed:', err)
      )
    }

    // Preserve our losing copies BEFORE requesting the winners (which overwrite
    // them). Wait for preservation, then ask for the files.
    void Promise.all(
      plan.conflicts.map((rel) =>
        preserveConflict(this.repsil, rel, this.identity.deviceName, enqueueExtraction).catch(
          (err) => console.error('sync: preserveConflict failed:', err)
        )
      )
    ).finally(() => {
      this.send({ t: 'need', files: plan.pullFiles, metaOnly: plan.pullMeta })
    })
  }

  private async onNeed(msg: Extract<SyncMessage, { t: 'need' }>): Promise<void> {
    for (const rel of msg.files) {
      const fileMsg = await readForSync(this.repsil, rel)
      if (fileMsg) this.send(fileMsg)
    }
    for (const rel of msg.metaOnly) {
      const metaMsg = metaMessageFor(this.repsil, rel)
      if (metaMsg) this.send(metaMsg)
    }
  }

  private isEmpty(): boolean {
    const docs = this.repsil.queries.countDocuments.get()?.n ?? 0
    if (docs > 0) return false
    const tombs = this.repsil.queries.listTombstones.all()
    return tombs.length === 0
  }

  private fail(message: string): void {
    if (this.closed) return
    this.cb.onError?.(message)
    this.close()
  }

  private handleClose(): void {
    this.unsubscribeLocalChanges()
    if (!this.closed) this.closed = true
    this.cb.onClose?.(this.peer)
  }
}
