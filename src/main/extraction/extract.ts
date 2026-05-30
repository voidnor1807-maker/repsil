import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RepsilDb } from '../db'
import type { DocumentRow, ExtractionStatus } from '../db/queries'
import { consumeMatch, consumeMatchBySize } from '../renameTracker'
import { getSettings } from '../settings'
import { emitMetaChanged } from '../sync/bus'
import { OCR_IMAGE_EXTS } from '@shared/extensions'
import { detectLanguage } from './language'
import { guessMetadata, type MetadataGuess } from './metadata'
import { ocrImage } from './ocr'
import { ocrPdf } from './pdfOcr'
import { extractPdf } from './pdfText'

type ProtectedField = 'title' | 'doc_date' | 'source' | 'notes'

function parseProtected(json: string): Set<ProtectedField> {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((s): s is ProtectedField => typeof s === 'string') as ProtectedField[])
  } catch {
    return new Set()
  }
}

async function sha256(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath)
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Extract one document. Skips silently if the row vanished. Updates DB with
 * extracted text, language, content_hash, and auto-filled metadata (honoring
 * user_edited_fields). Returns the final status.
 */
export async function extractOne(repsil: RepsilDb, id: number): Promise<ExtractionStatus> {
  const row = repsil.queries.getDocumentById.get(id) as DocumentRow | undefined
  if (!row) return 'failed'

  const abs = join(repsil.rootPath, row.rel_path)
  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(abs)
  } catch {
    return 'failed'
  }
  if (!stat.isFile()) return 'failed'

  const hash = await sha256(abs)

  // Rename recovery: if this is a brand-new row (no prior metadata) and a
  // recently-deleted file had the same hash, restore the user's curation.
  const isFresh =
    row.title === null && row.doc_date === null && row.source === null &&
    row.notes === null && row.user_edited_fields === '[]'
  if (isFresh) {
    const snap = consumeMatch(hash) ?? consumeMatchBySize(stat.size, row.ext)
    if (snap) {
      repsil.queries.restoreFromRename.run({
        id,
        title: snap.title,
        doc_date: snap.doc_date,
        source: snap.source,
        notes: snap.notes,
        user_edited_fields: snap.user_edited_fields
      })
      // Refresh the in-memory row so the downstream auto-fill respects it
      row.title = snap.title
      row.doc_date = snap.doc_date
      row.source = snap.source
      row.notes = snap.notes
      row.user_edited_fields = snap.user_edited_fields
    }
  }

  // Cache: if hash unchanged AND we already have text, just mark done.
  if (row.content_hash === hash && row.extracted_text !== null) {
    repsil.queries.updateExtraction.run({
      id,
      extracted_text: row.extracted_text,
      language: row.language,
      content_hash: hash,
      status: 'done',
      error_message: null,
      ocr_pages_done: row.ocr_pages_done,
      ocr_pages_total: row.ocr_pages_total
    })
    emitMetaChanged(row.rel_path)
    return 'done'
  }

  const settings = getSettings()
  let text = ''
  let status: ExtractionStatus = 'not_applicable'
  let errorMessage: string | null = null
  let ocrPagesDone: number | null = null
  let ocrPagesTotal: number | null = null

  if (row.ext === 'pdf') {
    if (row.ocr_requested) {
      // Hybrid per-page: digital text where present, OCR only empty pages.
      try {
        const r = await ocrPdf(abs, { maxPages: settings.pdfOcrMaxPages })
        text = r.text
        ocrPagesDone = r.pagesProcessed
        ocrPagesTotal = r.totalPages
        status = text.trim().length > 0 ? 'done' : 'not_applicable'
        if (r.truncated) {
          errorMessage = `Indexed first ${r.pagesProcessed} of ${r.totalPages} pages (page cap).`
        }
      } catch (err) {
        errorMessage = errToMessage(err)
        console.error(`pdf-ocr failed for ${row.rel_path}:`, err)
        status = 'failed'
      }
    } else {
      try {
        const result = await extractPdf(abs)
        text = result.text
        status = result.scanned ? 'not_applicable' : 'done'
        if (result.scanned) {
          errorMessage = 'Looks like a scanned PDF — enable OCR to index it.'
        }
      } catch (err) {
        errorMessage = errToMessage(err)
        console.error(`pdf extract failed for ${row.rel_path}:`, err)
        status = 'failed'
      }
    }
  } else if (OCR_IMAGE_EXTS.has(row.ext)) {
    if (row.ocr_requested) {
      try {
        const result = await ocrImage(abs)
        text = result.text
        status = text ? 'done' : 'not_applicable'
      } catch (err) {
        errorMessage = errToMessage(err)
        console.error(`ocr failed for ${row.rel_path}:`, err)
        status = 'failed'
      }
    } else {
      status = 'not_applicable'
    }
  } else {
    status = 'not_applicable'
  }

  const language = text ? detectLanguage(text) : null

  repsil.queries.updateExtraction.run({
    id,
    extracted_text: text || null,
    language,
    content_hash: hash,
    status,
    error_message: errorMessage,
    ocr_pages_done: ocrPagesDone,
    ocr_pages_total: ocrPagesTotal
  })

  if (text) {
    applyMetadataGuess(repsil, row, guessMetadata(text, row.filename, { dateFormat: settings.dateFormat }))
  }

  // Notify the renderer that this row's metadata/text changed so the dashboard
  // list re-renders (title now reflects OCR/extraction output instead of the
  // raw filename) and an open DocumentView can refresh.
  emitMetaChanged(row.rel_path)

  return status
}

function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function applyMetadataGuess(repsil: RepsilDb, row: DocumentRow, guess: MetadataGuess): void {
  const protectedFields = parseProtected(row.user_edited_fields)
  repsil.queries.updateMetadataFields.run({
    id: row.id,
    title: protectedFields.has('title') ? row.title : guess.title ?? row.title,
    doc_date: protectedFields.has('doc_date') ? row.doc_date : guess.doc_date ?? row.doc_date,
    source: protectedFields.has('source') ? row.source : guess.source ?? row.source
  })
}
