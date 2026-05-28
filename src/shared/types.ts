export type Language = 'en' | 'ar'
export type Theme = 'dark' | 'light'
export type DateFormat = 'dmy' | 'mdy'

export interface AppSettings {
  language: Language
  theme: Theme
  dateFormat: DateFormat
  pdfOcrMaxPages: number
  rootPath: string | null
  firstRunComplete: boolean
}

export interface PickFolderResult {
  canceled: boolean
  path: string | null
}

export interface DbStatus {
  open: boolean
  rootPath: string | null
  dbPath: string | null
  schemaVersion: number | null
  documentCount: number | null
}

export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'not_applicable'

export interface DocumentSummary {
  id: number
  rel_path: string
  filename: string
  ext: string
  size_bytes: number
  mtime: number
  title: string | null
  doc_date: string | null
  extraction_status: ExtractionStatus
}

export interface DocumentDetail extends DocumentSummary {
  ctime: number
  content_hash: string | null
  source: string | null
  notes: string | null
  extracted_text: string | null
  language: string | null
  ocr_requested: 0 | 1
  user_edited_fields: string
  error_message: string | null
  ocr_pages_done: number | null
  ocr_pages_total: number | null
}

export interface DocumentSummaryWithError extends DocumentSummary {
  error_message: string | null
}

export interface ExtractionQueueStatus {
  queued: number
  processedSinceStart: number
  pendingInDb: number
}

export type UserEditableField = 'title' | 'doc_date' | 'source' | 'notes'

export interface DocumentMetadataPatch {
  title?: string | null
  doc_date?: string | null
  source?: string | null
  notes?: string | null
}

export interface FolderSettings {
  rel_path: string
  ocr_default: boolean
  local_only: boolean
}

export interface FolderNode {
  rel_path: string
  name: string
  children: FolderNode[]
  ocr_default: boolean
  local_only: boolean
}

export interface Tag {
  id: number
  name: string
}

export interface TagWithUsage extends Tag {
  usage: number
}

export interface SearchFilters {
  dateFrom?: string | null
  dateTo?: string | null
  exts?: string[]
  tagIds?: number[]
  /** When true, match documents with ANY selected tag; default ALL. */
  anyTag?: boolean
  folderRel?: string | null
}

export interface SearchOptions {
  limit?: number
  offset?: number
}

export interface SearchResult {
  id: number
  rel_path: string
  filename: string
  title: string | null
  doc_date: string | null
  snippet: string
  extraction_status: ExtractionStatus
  error_message: string | null
}
