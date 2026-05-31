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
  meta_updated_at: number | null
  last_writer: string | null
}

/** One row of the sync manifest — the minimal shape peers exchange. */
export interface ManifestEntry {
  rel_path: string
  content_hash: string | null
  size_bytes: number
  mtime: number
  meta_updated_at: number | null
}

export interface TombstoneRow {
  rel_path: string
  content_hash: string | null
  deleted_at: number
  device: string | null
  // Shared-trash columns (M5). NULL on tombstones that did not preserve bytes.
  trash_id: string | null
  filename: string | null
  ext: string | null
  size_bytes: number | null
  deleted_by: string | null
  snap_title: string | null
  snap_doc_date: string | null
  snap_source: string | null
  snap_notes: string | null
  snap_user_edited_fields: string | null
}

/** A trash item view-model — tombstones whose file is still in .repsil/trash/. */
export interface TrashItemRow {
  trash_id: string
  rel_path: string
  filename: string
  ext: string | null
  size_bytes: number | null
  deleted_at: number
  deleted_by: string | null
  snap_title: string | null
  snap_doc_date: string | null
  snap_source: string | null
  snap_notes: string | null
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

    /** In-app rename/move: update the row's path-related fields in place so
     *  the document id (and tags / extracted_text / content_hash) survive. */
    renameDocumentByRelPath: db.prepare<{
      old_rel_path: string
      new_rel_path: string
      filename: string
      ext: string
    }>(`
      UPDATE documents
         SET rel_path = @new_rel_path,
             filename = @filename,
             ext = @ext
       WHERE rel_path = @old_rel_path
    `),

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
      meta_updated_at: number
      last_writer: string | null
    }>(`
      UPDATE documents
         SET title = @title,
             doc_date = @doc_date,
             source = @source,
             notes = @notes,
             user_edited_fields = @user_edited_fields,
             meta_updated_at = @meta_updated_at,
             last_writer = @last_writer
       WHERE id = @id
    `),

    // Bump the metadata clock without changing fields — used when tags change
    // (tags live in their own table but are part of a document's curated state).
    touchMeta: db.prepare<{ id: number; meta_updated_at: number; last_writer: string | null }>(`
      UPDATE documents
         SET meta_updated_at = @meta_updated_at, last_writer = @last_writer
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
             snippet(documents_fts, -1, '<mark>', '</mark>', '…', 16) AS snippet
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
    getAppSetting: db.prepare<string, { value: string }>(
      `SELECT value FROM app_settings WHERE key = ?`
    ),
    setAppSetting: db.prepare<{ key: string; value: string }>(`
      INSERT INTO app_settings (key, value) VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),

    countDocuments: db.prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM documents`
    ),

    // --- Phase 2: LAN sync ---

    // Full manifest of syncable documents. local_only filtering is applied in
    // JS (manifest.ts) via inheritsFolderFlag, which walks the folder ancestry.
    listForSync: db.prepare<[], ManifestEntry>(`
      SELECT rel_path, content_hash, size_bytes, mtime, meta_updated_at
        FROM documents
       ORDER BY rel_path
    `),

    // Apply curated metadata arriving from a peer, keyed by rel_path. Only the
    // synced fields are touched; extraction-derived columns stay local.
    upsertSyncedMetadata: db.prepare<{
      rel_path: string
      title: string | null
      doc_date: string | null
      source: string | null
      notes: string | null
      user_edited_fields: string
      meta_updated_at: number
      last_writer: string | null
    }>(`
      UPDATE documents
         SET title = @title,
             doc_date = @doc_date,
             source = @source,
             notes = @notes,
             user_edited_fields = @user_edited_fields,
             meta_updated_at = @meta_updated_at,
             last_writer = @last_writer
       WHERE rel_path = @rel_path
    `),

    // Tombstones — propagate deletes across peers. Extended in M5 to carry
    // the trash bundle (file ID, filename snapshot, metadata snapshot) so the
    // shared trash view can render entries from peers and either side can
    // restore.
    insertTombstone: db.prepare<{
      rel_path: string
      content_hash: string | null
      deleted_at: number
      device: string | null
      trash_id: string | null
      filename: string | null
      ext: string | null
      size_bytes: number | null
      deleted_by: string | null
      snap_title: string | null
      snap_doc_date: string | null
      snap_source: string | null
      snap_notes: string | null
      snap_user_edited_fields: string | null
    }>(`
      INSERT INTO tombstones (
        rel_path, content_hash, deleted_at, device,
        trash_id, filename, ext, size_bytes, deleted_by,
        snap_title, snap_doc_date, snap_source, snap_notes, snap_user_edited_fields
      )
      VALUES (
        @rel_path, @content_hash, @deleted_at, @device,
        @trash_id, @filename, @ext, @size_bytes, @deleted_by,
        @snap_title, @snap_doc_date, @snap_source, @snap_notes, @snap_user_edited_fields
      )
      ON CONFLICT(rel_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        deleted_at = excluded.deleted_at,
        device = excluded.device,
        trash_id = COALESCE(excluded.trash_id, tombstones.trash_id),
        filename = COALESCE(excluded.filename, tombstones.filename),
        ext = COALESCE(excluded.ext, tombstones.ext),
        size_bytes = COALESCE(excluded.size_bytes, tombstones.size_bytes),
        deleted_by = COALESCE(excluded.deleted_by, tombstones.deleted_by),
        snap_title = COALESCE(excluded.snap_title, tombstones.snap_title),
        snap_doc_date = COALESCE(excluded.snap_doc_date, tombstones.snap_doc_date),
        snap_source = COALESCE(excluded.snap_source, tombstones.snap_source),
        snap_notes = COALESCE(excluded.snap_notes, tombstones.snap_notes),
        snap_user_edited_fields = COALESCE(excluded.snap_user_edited_fields, tombstones.snap_user_edited_fields)
    `),
    listTombstones: db.prepare<[], TombstoneRow>(
      `SELECT rel_path, content_hash, deleted_at, device,
              trash_id, filename, ext, size_bytes, deleted_by,
              snap_title, snap_doc_date, snap_source, snap_notes, snap_user_edited_fields
         FROM tombstones`
    ),
    getTombstone: db.prepare<string, TombstoneRow>(
      `SELECT rel_path, content_hash, deleted_at, device,
              trash_id, filename, ext, size_bytes, deleted_by,
              snap_title, snap_doc_date, snap_source, snap_notes, snap_user_edited_fields
         FROM tombstones WHERE rel_path = ?`
    ),
    getTombstoneByTrashId: db.prepare<string, TombstoneRow>(
      `SELECT rel_path, content_hash, deleted_at, device,
              trash_id, filename, ext, size_bytes, deleted_by,
              snap_title, snap_doc_date, snap_source, snap_notes, snap_user_edited_fields
         FROM tombstones WHERE trash_id = ?`
    ),
    deleteTombstone: db.prepare<string>(
      `DELETE FROM tombstones WHERE rel_path = ?`
    ),
    pruneTombstones: db.prepare<number>(
      `DELETE FROM tombstones WHERE deleted_at < ?`
    ),
    /** Trash listing for the UI: only tombstones whose file is still on disk
     *  under .repsil/trash/{trash_id}/. Ordered newest first. */
    listTrashItems: db.prepare<[], TrashItemRow>(
      `SELECT trash_id, rel_path, filename, ext, size_bytes, deleted_at, deleted_by,
              snap_title, snap_doc_date, snap_source, snap_notes
         FROM tombstones
        WHERE trash_id IS NOT NULL AND filename IS NOT NULL
        ORDER BY deleted_at DESC`
    ),
    /** Clear the trash file pointer (after restore or purge) without losing
     *  the tombstone, so the deletion still propagates to peers. */
    clearTombstoneTrash: db.prepare<string>(
      `UPDATE tombstones SET trash_id = NULL, filename = NULL, ext = NULL,
              size_bytes = NULL,
              snap_title = NULL, snap_doc_date = NULL, snap_source = NULL,
              snap_notes = NULL, snap_user_edited_fields = NULL
        WHERE rel_path = ?`
    ),
    /** Tombstones that still have trash bytes AND are older than the cutoff.
     *  Used by the 30-day sweeper to find files to purge. */
    listTrashItemsOlderThan: db.prepare<number, TrashItemRow>(
      `SELECT trash_id, rel_path, filename, ext, size_bytes, deleted_at, deleted_by,
              snap_title, snap_doc_date, snap_source, snap_notes
         FROM tombstones
        WHERE trash_id IS NOT NULL AND deleted_at < ?`
    ),

    // Known peers (UI list).
    upsertPeer: db.prepare<{ device_id: string; name: string | null; last_seen: number }>(`
      INSERT INTO sync_peers (device_id, name, last_seen)
      VALUES (@device_id, @name, @last_seen)
      ON CONFLICT(device_id) DO UPDATE SET
        name = excluded.name,
        last_seen = excluded.last_seen
    `),
    listPeers: db.prepare<[], { device_id: string; name: string | null; last_seen: number }>(
      `SELECT device_id, name, last_seen FROM sync_peers ORDER BY last_seen DESC`
    )
  }
}
