import { promises as fs } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { ocrImage } from './ocr'
import { classifyPdfPages } from './scanDetect'

// pdfjs-dist's "legacy" build is the Node-friendly one. Its types are nominal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null

async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (pdfjsLib) return pdfjsLib
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsLib
}

// 3.0 = ~225 effective DPI from a 75-DPI PDF. Higher gives the LSTM more
// pixels per glyph (especially Arabic ligatures) at the cost of more memory
// per page. Pages render in serial so peak memory is one canvas at a time.
const RENDER_SCALE = 3.0
const DEFAULT_MAX_PAGES = 200

export interface PdfOcrResult {
  text: string
  pagesProcessed: number
  totalPages: number
  truncated: boolean
  ocrPageCount: number
}

export interface PdfOcrOptions {
  maxPages?: number
}

/**
 * Hybrid per-page PDF text extraction. For each page we first pull embedded
 * digital text; pages with no text are rendered to an image and OCR'd. This
 * means a mixed PDF (some digital pages, some scanned) is handled correctly
 * and we only pay the OCR cost on the pages that actually need it (F5).
 *
 * Page count is capped (configurable) to bound worst-case work on huge scans.
 */
export async function ocrPdf(absPath: string, opts: PdfOcrOptions = {}): Promise<PdfOcrResult> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await fs.readFile(absPath))
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    useSystemFonts: true
  }).promise

  const total = doc.numPages
  const limit = Math.min(total, maxPages)

  // Pass 1: digital text per page
  const digitalText: string[] = []
  const charCounts: number[] = []
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ').trim()
    digitalText.push(text)
    charCounts.push(text.length)
    page.cleanup()
  }

  // Decide which pages need OCR
  const { ocrPages } = classifyPdfPages(charCounts)
  const ocrSet = new Set(ocrPages)
  const finalPages = [...digitalText]

  // Pass 2: render + OCR only the empty pages
  for (const idx of ocrPages) {
    const page = await doc.getPage(idx + 1)
    try {
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      await page.render({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        canvasContext: ctx as any,
        viewport,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        canvas: canvas as any
      }).promise
      const png = canvas.toBuffer('image/png')
      const result = await ocrImage(png)
      finalPages[idx] = result.text
    } catch (err) {
      console.error(`pdf-ocr page ${idx + 1} failed:`, err)
      finalPages[idx] = ''
    }
    page.cleanup()
  }

  await doc.cleanup()
  await doc.destroy()

  return {
    text: finalPages.join('\f\n').trim(),
    pagesProcessed: limit,
    totalPages: total,
    truncated: total > limit,
    ocrPageCount: ocrSet.size
  }
}
