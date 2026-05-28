import type Database from 'better-sqlite3'

export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'not_applicable'

export interface DocumentRow {
  id: number
  rel_path: string
  filename: string
  ext: string
  size_bytes: number
  mtime: number
  ctime: number
  content_hash: string | null
  title: string | null
  doc_date: string | null
  source: string | null
  notes: string | null
  extracted_text: string | null
  language: string | null
  extraction_status: ExtractionStatus
  ocr_requested: 0 | 1
  user_edited_fields: string
  error_message: string | null
  ocr_pages_done: number | null
  ocr_pages_total: number | null
}

export interface NewDocument {
  rel_path: string
  filename: string
  ext: string
  size_bytes: number
  mtime: number
  ctime: number
}

export interface SearchHit {
  id: number
  rel_path: string
  filename: string
  title: string | null
  doc_date: string | null
  snippet: string
}

export type Queries = ReturnType<typeof createQueries>

/**
 * Prepared statements. Lazy-built on first DB open. The renderer never sees
 * these — IPC handlers wrap them.
 */
export function createQueries(db: Database.Database) {
  return {
    insertDocument: db.prepare<NewDocument>(`
      INSERT INTO documents (
        rel_path, filename, ext, size_bytes, mtime, ctime, extraction_status
      ) VALUES (
        @rel_path, @filename, @ext, @size_bytes, @mtime, @ctime, 'pending'
      )
    `),

    getDocumentByRelPath: db.prepare<string, DocumentRow>(
      `SELECT * FROM documents WHERE rel_path = ?`
    ),

    listDocumentsInFolder: db.prepare<string, DocumentRow>(
      // Direct children only: rel_path starts with prefix and has no further '/' after it
      `SELECT * FROM documents
       WHERE rel_path LIKE ? || '%'
         AND instr(substr(rel_path, length(?) + 1), '/') = 0
       ORDER BY filename`
    ),

    deleteDocumentByRelPath: db.prepare<string>(
      `DELETE FROM documents WHERE rel_path = ?`
    ),

    updateDocumentMtime: db.prepare<{ rel_path: string; mtime: number; size_bytes: number }>(`
      UPDATE documents
         SET mtime = @mtime, size_bytes = @size_bytes,
             extraction_status = 'pending'
       WHERE rel_path = @rel_path
    `),

    updateExtraction: db.prepare<{
      id: number
      extracted_text: string | null
      language: string | null
      content_hash: string | null
      status: ExtractionStatus
      error_message: string | null
      ocr_pages_done: number | null
      ocr_pages_total: number | null
    }>(`
      UPDATE documents
         SET extracted_text = @extracted_text,
             language = @language,
             content_hash = @content_hash,
             extraction_status = @status,
             error_message = @error_message,
             ocr_pages_done = @ocr_pages_done,
             ocr_pages_total = @ocr_pages_total
       WHERE id = @id
    `),

    updateMetadataFields: db.prepare<{
      id: number
      title: string | null
      doc_date: string | null
      source: string | null
    }>(`
      UPDATE documents
         SET title = @title,
             doc_date = @doc_date,
             source = @source
       WHERE id = @id
    `),

    updateUserMetadata: db.prepare<{
      id: number
      title: string | null
      doc_date: string | null
      source: string | null
      notes: string | null
      user_edited_fields: string
    }>(`
      UPDATE documents
         SET title = @title,
             doc_date = @doc_date,
             source = @source,
             notes = @notes,
             user_edited_fields = @user_edited_fields
       WHERE id = @id
    `),

    restoreFromRename: db.prepare<{
      id: number
      title: string | null
      doc_date: string | null
      source: string | null
      notes: string | null
      user_edited_fields: string
    }>(`
      UPDATE documents
         SET title = @title,
             doc_date = @doc_date,
             source = @source,
             notes = @notes,
             user_edited_fields = @user_edited_fields
       WHERE id = @id
    `),

    getDocumentById: db.prepare<number, DocumentRow>(
      `SELECT * FROM documents WHERE id = ?`
    ),

    findPendingDocuments: db.prepare<[], { id: number }>(
      `SELECT id FROM documents WHERE extraction_status = 'pending' ORDER BY id LIMIT 5000`
    ),

    setOcrRequested: db.prepare<number>(
      `UPDATE documents SET ocr_requested = 1, extraction_status = 'pending' WHERE id = ?`
    ),

    requeueDocument: db.prepare<number>(
      `UPDATE documents SET extraction_status = 'pending', error_message = NULL WHERE id = ?`
    ),

    setExtractedText: db.prepare<{ id: number; extracted_text: string | null }>(
      `UPDATE documents SET extracted_text = @extracted_text WHERE id = @id`
    ),

    getFolderSettings: db.prepare<string, { rel_path: string; ocr_default: 0 | 1; local_only: 0 | 1 }>(
      `SELECT * FROM folder_settings WHERE rel_path = ?`
    ),

    upsertFolderSettings: db.prepare<{
      rel_path: string
      ocr_default: 0 | 1
      local_only: 0 | 1
    }>(`
      INSERT INTO folder_settings (rel_path, ocr_default, local_only)
      VALUES (@rel_path, @ocr_default, @local_only)
      ON CONFLICT(rel_path) DO UPDATE SET
        ocr_default = excluded.ocr_default,
        local_only = excluded.local_only
    `),

    countByStatus: db.prepare<ExtractionStatus, { n: number }>(
      `SELECT COUNT(*) AS n FROM documents WHERE extraction_status = ?`
    ),

    searchDocuments: db.prepare<string, SearchHit>(`
      SELECT d.id, d.rel_path, d.filename, d.title, d.doc_date,
             snippet(documents_fts, 4, '<mark>', '</mark>', '…', 16) AS snippet
        FROM documents_fts
        JOIN documents d ON d.id = documents_fts.rowid
       WHERE documents_fts MATCH ?
       ORDER BY rank
       LIMIT 200
    `),

    // Tags
    listTags: db.prepare<[], { id: number; name: string; usage: number }>(`
      SELECT t.id, t.name, COUNT(dt.document_id) AS usage
        FROM tags t
        LEFT JOIN document_tags dt ON dt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE
    `),
    getTagsForDocument: db.prepare<number, { id: number; name: string }>(`
      SELECT t.id, t.name
        FROM tags t
        JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = ?
       ORDER BY t.name COLLATE NOCASE
    `),
    upsertTag: db.prepare<string, { id: number }>(`
      INSERT INTO tags (name) VALUES (?)
        ON CONFLICT(name) DO UPDATE SET name = excluded.name
        RETURNING id
    `),
    clearDocumentTags: db.prepare<number>(
      `DELETE FROM document_tags WHERE document_id = ?`
    ),
    linkTag: db.prepare<{ document_id: number; tag_id: number }>(
      `INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (@document_id, @tag_id)`
    ),
    pruneUnusedTags: db.prepare(
      `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM document_tags)`
    ),

    // All folder rel_paths that have any setting row
    listAllFolderSettings: db.prepare<[], { rel_path: string; ocr_default: 0 | 1; local_only: 0 | 1 }>(
      `SELECT rel_path, ocr_default, local_only FROM folder_settings`
    ),

    // Archive-scoped app settings (C2)
    listAppSettings: db.prepare<[], { key: string; value: string }>(
      `SELECT key, value FROM app_settings`
    ),
    setAppSetting: db.prepare<{ key: string; value: string }>(`
      INSERT INTO app_settings (key, value) VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),

    countDocuments: db.prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM documents`
    )
  }
}
