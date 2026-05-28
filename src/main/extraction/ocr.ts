import { createWorker, type Worker } from 'tesseract.js'
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

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cfg = resolveLangConfig()
      const w = await createWorker(LANGS.split('+'), undefined, {
        langPath: cfg.langPath,
        cachePath: cfg.cachePath,
        gzip: cfg.gzip
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
  const { data } = await w.recognize(input)
  const result = { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 }
  sinceRecycle++
  if (sinceRecycle >= RECYCLE_AFTER) {
    sinceRecycle = 0
    // Serial OCR lane — safe to tear down now; next job recreates the worker.
    await terminateOcr()
  }
  return result
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return
  try {
    const w = await workerPromise
    await w.terminate()
  } catch {
    // worker may already be torn down or failed to init — nothing to do
  }
  workerPromise = null
}
