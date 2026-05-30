import { createWorker, PSM, type Worker } from 'tesseract.js'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Locate bundled traineddata. When present (packaged build ships them under
 * resources/tessdata, unpacked from asar), OCR works fully offline. Otherwise
 * we fall back to tesseract.js's CDN download, cached under userData so it
 * only downloads once.
 */
function resolveLangConfig(): { langPath?: string; cachePath: string; gzip: boolean } {
  const cachePath = join(app.getPath('userData'), 'tessdata')
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'tessdata') : '',
    join(app.getAppPath(), 'resources', 'tessdata'),
    join(process.cwd(), 'resources', 'tessdata')
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'eng.traineddata')) && existsSync(join(dir, 'ara.traineddata'))) {
      return { langPath: dir, cachePath: dir, gzip: false }
    }
  }
  return { cachePath, gzip: true }
}

/**
 * Tesseract.js wrapper. Lazy singleton — the first recognize() call spins
 * up a worker loaded with eng + ara. tesseract.js internally runs each
 * recognize call in its own Node worker, so this never blocks the main
 * Electron thread despite our queue being single-process.
 *
 * Language packs: tesseract.js downloads them from its CDN on first use
 * (~10MB each). For offline/installer builds we'll bundle traineddata under
 * resources/tessdata/ and point langPath at it — Phase 3 work.
 */

const LANGS = 'eng+ara'
// Recycle the worker after this many recognitions to cap memory growth (E3).
const RECYCLE_AFTER = 50

let workerPromise: Promise<Worker> | null = null
let sinceRecycle = 0
// Resolves when no recognize() is currently running. terminateOcr awaits this
// so the worker is never torn down mid-recognition (CR-03).
let recognizeInFlight: Promise<void> = Promise.resolve()

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cfg = resolveLangConfig()
      const w = await createWorker(LANGS.split('+'), undefined, {
        langPath: cfg.langPath,
        cachePath: cfg.cachePath,
        gzip: cfg.gzip
      })
      // PSM 1 = auto layout analysis WITH orientation/script detection. Costs
      // a small amount of extra CPU per page but lets us handle rotated scans
      // and mixed-script (Arabic+English) screenshots correctly without
      // per-image config. user_defined_dpi=300 hints the LSTM model so it
      // doesn't underscale screenshots and undersized scans.
      // preserve_interword_spaces keeps Arabic word breaks intact instead of
      // collapsing them, which the metadata guesser and FTS tokenizer rely on.
      await w.setParameters({
        tessedit_pageseg_mode: PSM.AUTO_OSD,
        user_defined_dpi: '300',
        preserve_interword_spaces: '1'
      })
      return w
    })().catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

export interface OcrResult {
  text: string
  confidence: number
}

export async function ocrImage(input: string | Buffer): Promise<OcrResult> {
  const w = await getWorker()
  // Mark a recognition as in flight so terminateOcr can wait it out. We never
  // recycle from inside here — that would tear the worker down mid-PDF when a
  // single document needs >RECYCLE_AFTER pages (CR-03). Recycling happens at
  // the job boundary via maybeRecycleOcr().
  let release!: () => void
  recognizeInFlight = new Promise<void>((r) => {
    release = r
  })
  try {
    const { data } = await w.recognize(input)
    sinceRecycle++
    return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 }
  } finally {
    release()
  }
}

/**
 * Recycle the worker if it has done enough recognitions. Call this BETWEEN
 * queue jobs, never mid-document. Caps memory growth without racing the
 * per-page PDF OCR loop (E3 + CR-03).
 */
export async function maybeRecycleOcr(): Promise<void> {
  if (sinceRecycle >= RECYCLE_AFTER) {
    await terminateOcr()
  }
}

export async function terminateOcr(): Promise<void> {
  // Wait for any in-flight recognition so we never terminate a busy worker.
  await recognizeInFlight.catch(() => {})
  if (!workerPromise) return
  try {
    const w = await workerPromise
    await w.terminate()
  } catch {
    // worker may already be torn down or failed to init — nothing to do
  }
  workerPromise = null
  sinceRecycle = 0
}
