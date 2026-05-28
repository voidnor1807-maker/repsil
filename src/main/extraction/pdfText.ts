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

export async function extractPdf(absPath: string): Promise<PdfExtraction> {
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
