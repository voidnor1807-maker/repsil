import type { RepsilDb } from '../db'
import type { DocumentRow } from '../db/queries'
import { OCR_IMAGE_EXTS } from '@shared/extensions'
import { extractOne } from './extract'
import { maybeRecycleOcr } from './ocr'

/**
 * Two-lane in-process extraction queue.
 *  - fast lane: digital text (cheap, near-instant) — drained eagerly
 *  - slow lane: OCR jobs (images, OCR-requested PDFs) — won't starve the fast
 *    lane because they run on an independent promise chain
 *
 * Each lane is serial within itself. tesseract.js already runs OCR off the
 * main thread, so the slow lane never blocks the UI.
 */
let fastChain: Promise<void> = Promise.resolve()
let slowChain: Promise<void> = Promise.resolve()
const queued = new Set<number>()
let processedSinceStart = 0
let activeRepsil: RepsilDb | null = null

export function bindQueue(repsil: RepsilDb): void {
  activeRepsil = repsil
  fastChain = Promise.resolve()
  slowChain = Promise.resolve()
  queued.clear()
  processedSinceStart = 0
}

export function unbindQueue(): void {
  activeRepsil = null
  queued.clear()
}

function isOcrJob(row: DocumentRow): boolean {
  if (OCR_IMAGE_EXTS.has(row.ext)) return true
  if (row.ext === 'pdf' && row.ocr_requested === 1) return true
  return false
}

export function enqueueExtraction(id: number): void {
  if (!activeRepsil) return
  if (queued.has(id)) return
  queued.add(id)
  const repsil = activeRepsil

  const row = repsil.queries.getDocumentById.get(id) as DocumentRow | undefined
  const ocr = row ? isOcrJob(row) : false

  const run = async (): Promise<void> => {
    // The archive was switched out from under this job between enqueue and run.
    // Dropping it is safe: the row is still extraction_status='pending' in its
    // DB, so drainPending() at bind time and the periodic reconcile both
    // re-enqueue it against the correct archive (WR-05).
    if (activeRepsil !== repsil) return
    try {
      await extractOne(repsil, id)
      processedSinceStart++
    } catch (err) {
      console.error(`extractOne(${id}) threw:`, err)
    } finally {
      queued.delete(id)
      // Recycle the OCR worker only between jobs, never mid-document (CR-03).
      if (ocr) await maybeRecycleOcr()
    }
  }

  if (ocr) {
    slowChain = slowChain.then(run).catch((err) => console.error('ocr queue error:', err))
  } else {
    fastChain = fastChain.then(run).catch((err) => console.error('fast queue error:', err))
  }
}

export function drainPending(): number {
  if (!activeRepsil) return 0
  const pending = activeRepsil.queries.findPendingDocuments.all() as { id: number }[]
  for (const { id } of pending) enqueueExtraction(id)
  return pending.length
}

export interface QueueStatus {
  queued: number
  processedSinceStart: number
  pendingInDb: number
}

export function queueStatus(): QueueStatus {
  return {
    queued: queued.size,
    processedSinceStart,
    pendingInDb: activeRepsil
      ? (activeRepsil.queries.countByStatus.get('pending')?.n ?? 0)
      : 0
  }
}
