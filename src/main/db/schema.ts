/**
 * Versioned schema. Each entry is one migration applied in order via
 * PRAGMA user_version. Never edit a shipped migration — add a new one.
 */
export interface Migration {
  version: number
  sql: string
}

const M1_INITIAL = `
CREATE TABLE documents (
  id                  INTEGER PRIMARY KEY,
  rel_path            TEXT NOT NULL UNIQUE,
  filename            TEXT NOT NULL,
  ext                 TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  mtime               INTEGER NOT NULL,
  ctime               INTEGER NOT NULL,
  content_hash        TEXT,
  title               TEXT,
  doc_date            TEXT,
  source              TEXT,
  notes               TEXT,
  extracted_text      TEXT,
  language            TEXT,
  extraction_status   TEXT NOT NULL,
  ocr_requested       INTEGER NOT NULL DEFAULT 0,
  user_edited_fields  TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_documents_doc_date ON documents(doc_date);
CREATE INDEX idx_documents_ext      ON documents(ext);
CREATE INDEX idx_documents_status   ON documents(extraction_status);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE document_tags (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
CREATE INDEX idx_document_tags_tag ON document_tags(tag_id);

CREATE TABLE folder_settings (
  rel_path     TEXT PRIMARY KEY,
  ocr_default  INTEGER NOT NULL DEFAULT 0,
  local_only   INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
  rel_path, title, source, notes, extracted_text,
  content='documents',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, rel_path, title, source, notes, extracted_text)
  VALUES (new.id, new.rel_path, new.title, new.source, new.notes, new.extracted_text);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, rel_path, title, source, notes, extracted_text)
  VALUES('delete', old.id, old.rel_path, old.title, old.source, old.notes, old.extracted_text);
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, rel_path, title, source, notes, extracted_text)
  VALUES('delete', old.id, old.rel_path, old.title, old.source, old.notes, old.extracted_text);
  INSERT INTO documents_fts(rowid, rel_path, title, source, notes, extracted_text)
  VALUES (new.id, new.rel_path, new.title, new.source, new.notes, new.extracted_text);
END;
`

const M2_EXTRACTION_REPORTING = `
ALTER TABLE documents ADD COLUMN error_message TEXT;
ALTER TABLE documents ADD COLUMN ocr_pages_done INTEGER;
ALTER TABLE documents ADD COLUMN ocr_pages_total INTEGER;
`

// Archive-scoped settings that should travel with the archive (e.g. the date
// convention used to interpret this archive's documents). Machine-scoped prefs
// (language, theme, window) stay in userData. (C2)
const M3_APP_SETTINGS = `
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// Phase 2 (LAN sync). meta_updated_at drives last-writer-wins on curated
// metadata; last_writer records the originating device. tombstones let deletes
// propagate instead of files resurrecting on the next sync. sync_peers backs
// the UI peer list.
const M4_SYNC = `
ALTER TABLE documents ADD COLUMN meta_updated_at INTEGER;
ALTER TABLE documents ADD COLUMN last_writer TEXT;

CREATE TABLE tombstones (
  rel_path     TEXT PRIMARY KEY,
  content_hash TEXT,
  deleted_at   INTEGER NOT NULL,
  device       TEXT
);

CREATE TABLE sync_peers (
  device_id  TEXT PRIMARY KEY,
  name       TEXT,
  last_seen  INTEGER
);
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: M1_INITIAL },
  { version: 2, sql: M2_EXTRACTION_REPORTING },
  { version: 3, sql: M3_APP_SETTINGS },
  { version: 4, sql: M4_SYNC }
]
