import { promises as fs } from 'node:fs'
// Import the lib entry directly to skip pdf-parse's index.js test harness,
// which tries to read a sample file at require-time and crashes if missing.
import pdf from 'pdf-parse/lib/pdf-parse.js'

interface PdfParseResult {
  text: string
  numpages: number
  numrender: number
  info: unknown
  metadata: unknown
  version: string
}

export interface PdfExtraction {
  text: string
  pageCount: number
  /** True when the file had no embedded text — caller should consider OCR. */
  scanned: boolean
}

const SCANNED_THRESHOLD_CHARS_PER_PAGE = 8
// Guard the serial fast lane: a single multi-GB / malformed PDF read whole into
// memory could exhaust the heap and starve all other extraction (WR-06).
const MAX_PDF_BYTES = 100 * 1024 * 1024

export async function extractPdf(absPath: string): Promise<PdfExtraction> {
  const stat = await fs.stat(absPath)
  if (stat.size > MAX_PDF_BYTES) {
    throw new Error(`PDF too large to index (${Math.round(stat.size / (1024 * 1024))} MB)`)
  }
  const buffer = await fs.readFile(absPath)
  const result = (await pdf(buffer)) as PdfParseResult
  const text = result.text ?? ''
  const charsPerPage = result.numpages > 0 ? text.trim().length / result.numpages : 0
  return {
    text: text.trim(),
    pageCount: result.numpages,
    scanned: charsPerPage < SCANNED_THRESHOLD_CHARS_PER_PAGE
  }
}
