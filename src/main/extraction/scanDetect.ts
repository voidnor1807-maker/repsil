export interface PdfPageClassification {
  kind: 'digital' | 'scanned' | 'partial'
  /** 0-based indices of pages that have no extractable text and need OCR. */
  ocrPages: number[]
}

const MIN_CHARS_PER_PAGE = 8

/**
 * Classify a PDF from its per-page extractable-character counts. A page below
 * the threshold is treated as a scan needing OCR. This lets us OCR only the
 * image pages of a mixed (partial) document instead of all-or-nothing.
 */
export function classifyPdfPages(perPageCharCounts: number[]): PdfPageClassification {
  if (perPageCharCounts.length === 0) return { kind: 'scanned', ocrPages: [] }

  const ocrPages: number[] = []
  perPageCharCounts.forEach((count, i) => {
    if (count < MIN_CHARS_PER_PAGE) ocrPages.push(i)
  })

  if (ocrPages.length === 0) return { kind: 'digital', ocrPages: [] }
  if (ocrPages.length === perPageCharCounts.length) return { kind: 'scanned', ocrPages }
  return { kind: 'partial', ocrPages }
}
