# Plan: Local Document Archive + LAN Sync (Working name: "Repsil")

## Context

The user does (or works with people who do) a lot of paperwork. They want a Windows-installable desktop app that turns a chosen folder on disk into a modern, searchable archive — and that automatically replicates contents to a second paired laptop over Wi-Fi, with **no cloud services** of any kind.

The app must:
- Be installed locally via a Windows installer.
- Use a chosen folder as the source of truth — files dropped via Windows Explorer behave the same as files added through the app.
- Provide a modern dashboard UI (IDE-style "open folder" mental model) for browsing folders, viewing documents, and editing metadata.
- Extract text from PDFs (digital text + opt-in OCR for scanned pages and images) so any keyword on any page finds the document.
- Replicate contents between paired devices on the same Wi-Fi network, automatically, encrypted, and with offline-tolerant conflict handling.
- Support **English and Arabic** content (file/folder names, PDF text extraction, search, and the UI itself, including RTL layout).

The goal is one cohesive product. To keep risk and scope manageable, we deliver it in **three phases**, each independently shippable.

---

## Locked-in Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Tech stack | **Electron + React + TypeScript** |
| Source of truth | **Filesystem.** App watches a user-chosen root folder; Windows Explorer remains a valid entry point. |
| Storage location | User-chosen root directory on the local disk. Sidecar SQLite DB lives inside `.repsil/` at the root. |
| PDF text extraction | Digital PDFs always extracted (cheap, near-100% accurate). **OCR is opt-in per folder or per file** (Tesseract; bundled with `eng` + `ara` language packs). |
| Metadata model | Tags + free-text notes + **Document Date** + Title (auto from filename) + Source/From. |
| Auto-fill | Extraction silently auto-fills metadata. No confidence badges, no review queue. User edits when they notice something wrong. User edits are never overwritten by re-extraction. |
| Search | Full-text search (SQLite FTS5, `unicode61` tokenizer) over extracted text + metadata + filenames. |
| Peer scale | 2 devices for v1, designed to extend to ~5 trusted devices later. |
| Sync scope | Everything in the root syncs by default; per-folder **"Local only"** flag suppresses sync for that subtree. |
| Conflict policy | Last-write-wins (LWW). Loser kept as `name (conflict from <DeviceName> <YYYY-MM-DD>).ext` in the same folder. |
| Delete policy | Deletes route through a **synced Trash** (`.repsil/trash/`), retained ~30 days, then auto-purged. |
| Pairing | mDNS auto-discovery + 6-digit PIN + mutual TLS (both sides generate keys at install time; pairing exchanges public certs). |
| Transport | Encrypted HTTP/WebSocket over TLS on the LAN. |
| Localization | Full EN + AR. UI strings via `react-i18next`. RTL layout mirroring when language is Arabic. Arabic-capable bundled font. |

---

## Phasing

### Phase 1 — Local archive (single device)
The full app minus networking. A genuinely useful product on its own: a modern, searchable dashboard over a folder of paperwork.

### Phase 2 — Pairing + sync engine
Add device pairing, encrypted LAN transport, file replication, conflict handling, synced Trash, "local only" flag. The headline feature.

### Phase 3 — Installer + first release
NSIS installer, app icon, system tray, auto-start on login, first-run setup wizard, settings screen. Polish needed to actually distribute it.

Each phase is shippable. Phases 2 and 3 do not invalidate any Phase 1 work.

---

## High-level architecture (whole v1)

Electron app with three logical processes:

- **Main process (Node.js)** — Owns the SQLite DB (`better-sqlite3`), the file system watcher (`chokidar`), the OCR worker pool, the sync engine, and IPC with the renderer. All disk and network I/O lives here.
- **Renderer process (React)** — Dashboard UI. Talks to the main process via a typed IPC bridge (`contextBridge` in a `preload.ts`). Never touches disk directly.
- **Worker threads** — One for text-extraction/OCR (so the UI never stalls on a 500-page scanned PDF). One for the sync engine in Phase 2 (so file watching never blocks on network I/O).

### Modules (folder layout)

```
repsil/
├── src/
│   ├── main/
│   │   ├── index.ts                 # Electron entry, window lifecycle
│   │   ├── ipc.ts                   # Typed IPC handlers, exposed to renderer
│   │   ├── db/
│   │   │   ├── schema.sql           # SQLite + FTS5 schema (migrations versioned)
│   │   │   ├── migrate.ts           # Run pending migrations on startup
│   │   │   └── queries.ts           # Prepared statements (folders, docs, search)
│   │   ├── watcher/
│   │   │   └── fileWatcher.ts       # chokidar wrapper, debounced add/change/unlink events
│   │   ├── extraction/
│   │   │   ├── pdfText.ts           # pdf-parse for digital PDFs
│   │   │   ├── ocr.ts               # Tesseract.js worker; eng + ara language packs
│   │   │   ├── language.ts          # Detect doc language (Unicode script + franc)
│   │   │   └── metadata.ts          # Heuristic auto-fill (doc date regex, title from heading/filename, source from letterhead)
│   │   ├── sync/                    # Phase 2
│   │   │   ├── discovery.ts         # mDNS (bonjour-service)
│   │   │   ├── pairing.ts           # PIN flow, cert exchange, persistent peer list
│   │   │   ├── transport.ts         # mTLS WebSocket server + client
│   │   │   ├── protocol.ts          # Sync messages: manifest, request, chunk, ack, tombstone
│   │   │   ├── engine.ts            # Per-peer sequence numbers, conflict resolution, Trash plumbing
│   │   │   └── trash.ts             # Synced trash with 30-day retention sweeper
│   │   └── settings.ts              # User settings (root path, OCR opt-ins, language, theme)
│   ├── preload/
│   │   └── preload.ts               # contextBridge: exposes typed IPC API to renderer
│   └── renderer/
│       ├── index.tsx
│       ├── App.tsx
│       ├── i18n/                    # react-i18next setup, en.json, ar.json
│       ├── theme/                   # Light + dark, RTL-aware styles
│       ├── pages/
│       │   ├── Dashboard.tsx        # Sidebar tree + main content
│       │   ├── FolderView.tsx       # List/grid of documents in a folder
│       │   ├── DocumentView.tsx     # PDF/image viewer + metadata panel + extracted text
│       │   ├── SearchView.tsx       # Search bar + results + filters
│       │   ├── Settings.tsx
│       │   └── Pairing.tsx          # Phase 2
│       └── components/              # Reusable UI primitives
├── resources/
│   ├── tessdata/                    # Tesseract: eng.traineddata, ara.traineddata
│   ├── fonts/                       # Arabic-capable font (e.g. Noto Naskh Arabic)
│   └── icons/
├── electron-builder.yml             # Phase 3
└── package.json
```

---

## Phase 1 — Local archive (detailed)

### Data model

**On disk:**
- User picks a root folder (e.g. `D:\MyArchive`) on first run.
- Files and subfolders live there normally — same as any Explorer folder.
- The app creates `D:\MyArchive\.repsil\` for its own state:
  - `repsil.db` — SQLite database (metadata, FTS5 index, settings).
  - `trash/` — Phase 2 synced Trash (created in Phase 2).
  - `device.json` — device identity (UUID, friendly name, generated TLS keypair). Created in Phase 2.

**SQLite schema (simplified, Phase 1 only — Phase 2 adds sync columns):**

```sql
-- Every file currently present in the root (excluding .repsil/)
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY,
  rel_path     TEXT NOT NULL UNIQUE,    -- path relative to root, normalized (forward slashes)
  filename     TEXT NOT NULL,
  ext          TEXT NOT NULL,           -- lowercase, no dot
  size_bytes   INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,        -- filesystem mtime (epoch ms)
  ctime        INTEGER NOT NULL,
  content_hash TEXT,                    -- SHA-256 of file bytes; populated by extraction worker; used for rename detection and extraction caching
  -- User-editable metadata (NULL until set):
  title        TEXT,
  doc_date     TEXT,                    -- ISO date string (the date ON the document)
  source       TEXT,                    -- "ACME Insurance" etc.
  notes        TEXT,
  -- Extraction state:
  extracted_text  TEXT,                 -- raw extracted text (or NULL)
  language        TEXT,                 -- 'en', 'ar', or NULL
  extraction_status TEXT NOT NULL,      -- 'pending' | 'done' | 'failed' | 'not_applicable'
  ocr_requested   INTEGER NOT NULL DEFAULT 0,  -- 0/1, set by user opt-in
  -- Bookkeeping:
  user_edited_fields TEXT NOT NULL DEFAULT '[]'  -- JSON array of field names the user has manually edited; auto-fill never overwrites these
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE document_tags (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- Per-folder settings (sparse: most folders have no row)
CREATE TABLE folder_settings (
  rel_path     TEXT PRIMARY KEY,        -- folder rel path
  ocr_default  INTEGER NOT NULL DEFAULT 0,  -- if 1, OCR is auto-applied to new files in this folder
  local_only   INTEGER NOT NULL DEFAULT 0   -- Phase 2: don't sync this subtree
);

-- Full-text search index (covers extracted text + metadata + filename)
CREATE VIRTUAL TABLE documents_fts USING fts5(
  rel_path, title, source, notes, extracted_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
-- Triggers keep documents_fts in sync with documents (insert/update/delete).
```

### Key flows

**On startup:**
1. Open DB, run pending migrations.
2. Start `chokidar` watcher on the root, ignoring `.repsil/`.
3. Reconcile DB vs. disk: insert rows for new files, mark deleted rows for removal, update changed files. Queue extraction for new/changed files.

**On file add (from Explorer or app):**
1. Watcher fires, debounced 250ms.
2. Insert `documents` row with `extraction_status='pending'`.
3. Enqueue extraction job.

**Extraction worker:**
1. If file is a digital PDF (text-PDF detection via `pdf-parse`): extract text, set `extracted_text` + `language`, set status `done`.
2. If file is `.pdf` with no embedded text, or `.png`/`.jpg`/`.jpeg`/`.tiff`/`.webp`, and the folder OR file has OCR opted-in: run Tesseract with detected language (default `eng+ara`), set `extracted_text` + `language`.
3. Heuristic metadata auto-fill (only for fields not in `user_edited_fields`):
   - `doc_date`: regex sweep for common formats (ISO, `DD/MM/YYYY`, `MM/DD/YYYY`, written months in EN + AR, Arabic-Indic digits). Pick the earliest plausible date in the first ~2000 characters.
   - `title`: first non-empty line if it's <100 chars and looks like a heading; else filename without extension.
   - `source`: rough heuristic — first line that looks like a proper noun in the first ~10 lines (kept simple in v1; can be improved later).
4. Update FTS index via triggers.

**On file modified / deleted / renamed:** watcher fires, DB updated, extraction re-queued for modifications, row removed for deletions.

**Search:**
- One search box in the UI. Query goes against FTS5 across `rel_path`, `title`, `source`, `notes`, `extracted_text`.
- Filters in a sidebar: date range (matches `doc_date`), tags, file type, source, folder.
- Results show filename, folder, document date, file type, and a snippet of the matching text (FTS5 `snippet()` function).

### UI shape (Phase 1)

IDE-style two-pane dashboard:
- **Left sidebar:** folder tree (mirrors the disk structure under the root). Right-click for "Set OCR default", "Open in Explorer", etc.
- **Main pane:** depends on selection.
  - Folder selected → grid/list of documents with thumbnail, title, doc date, tags.
  - Document selected → split view: PDF/image preview on the left, metadata panel + extracted-text panel on the right.
- **Top bar:** global search, language toggle (EN/AR — toggling flips layout to RTL), theme toggle (light/dark), settings.
- **Bottom status bar:** root path, last-indexed indicator, extraction queue length.

### Phase 1 deliverables (when this phase is "done")

1. App boots, prompts for a root folder on first run, persists the choice.
2. Files added via Explorer appear in the dashboard within ~1 second.
3. Digital PDFs in EN or AR are searchable by any word on any page within a few seconds of being added.
4. User can right-click a folder, "Enable OCR for new files", and scanned PDFs/images added there become searchable (slower — ~1–5s per page).
5. User can edit Title, Document Date, Source, Notes, and Tags on any document; edits persist and are never overwritten by re-extraction.
6. Search works across content and metadata; filters by date/tags/type work.
7. UI is fully bilingual; toggling to Arabic mirrors layout to RTL.
8. Deleting a file in Explorer removes it from the dashboard; renaming preserves metadata (matched by inode/size+content hash within a short window).

---

## Phase 2 — Pairing + sync engine (sketch)

### Schema additions
```sql
ALTER TABLE documents ADD COLUMN device_id     TEXT;       -- which device last wrote this version
ALTER TABLE documents ADD COLUMN version_seq   INTEGER;    -- per-device monotonic sequence number
ALTER TABLE documents ADD COLUMN tombstone     INTEGER NOT NULL DEFAULT 0;  -- 1 if deleted/trashed
ALTER TABLE documents ADD COLUMN trashed_at    INTEGER;    -- epoch ms when moved to Trash
-- content_hash already exists from Phase 1; reused as the sync-versioning identifier.

CREATE TABLE peers (
  device_id     TEXT PRIMARY KEY,
  friendly_name TEXT NOT NULL,
  public_cert   BLOB NOT NULL,           -- TLS cert from pairing
  last_seen     INTEGER,
  last_synced_seq_per_device TEXT NOT NULL DEFAULT '{}'  -- JSON: {peerId: lastSeqFromThatPeer}
);
```

### Pairing flow
1. Laptop A — Pair new device → app generates 6-digit PIN, displays it, begins advertising on mDNS.
2. Laptop B — app scans mDNS, shows "Found: Laptop A" → user clicks, enters PIN.
3. Devices perform a short challenge-response: PIN proves intent, then both sides exchange long-lived TLS public certs. Certs are stored in `peers`.
4. From here on, devices accept TLS connections only from peers whose cert is in the `peers` table (mutual TLS). PIN is single-use.

### Transport & protocol
- TLS WebSocket on a fixed port (configurable; default e.g. `47823`). mDNS service type `_repsil._tcp`.
- Wire protocol (Phase 2 v1):
  - `HELLO` — exchange device IDs, advertise our highest seq per known peer.
  - `MANIFEST_REQUEST(since_seq_per_device)` — "tell me what changed since this state."
  - `MANIFEST(entries[])` — list of `{rel_path, content_hash, mtime, doc_date?, title?, source?, notes?, tags?, tombstone, version_seq, device_id}`.
  - `FILE_REQUEST(rel_path, content_hash)` — request bytes for a specific version.
  - `FILE_CHUNK(...)` / `FILE_END(...)` — streamed file bytes with rolling hash.
  - `ACK(up_to_seq_per_device)` — peer confirms it has applied changes up to these sequence numbers.

### Conflict resolution
- For two updates to the same `rel_path` with different `content_hash` and neither being a strict ancestor of the other (per stored `(device_id, version_seq)`):
  - Compare `mtime`. Newer wins (LWW).
  - Loser is saved as `<basename> (conflict from <peerFriendlyName> <YYYY-MM-DD>).<ext>` in the same folder, gets its own DB row.
- For deletes vs. concurrent edit: edit wins (the deleting peer will receive the edited version on next sync; the file reappears for them).

### Synced Trash
- Local delete (from app or Explorer) → file moved to `.repsil/trash/<original-rel-path>` with sidecar `<file>.meta.json` capturing original rel_path, `trashed_at`, and metadata snapshot.
- DB row marked `tombstone=1`, `trashed_at=now`, given a new `version_seq`.
- Tombstone propagates via normal manifest sync. On receipt, peer moves their copy to its own local `.repsil/trash/`.
- Sweeper runs daily: rows with `tombstone=1 AND trashed_at < now - 30 days` are hard-deleted from both DB and the trash directory.
- UI has a "Trash" view in the sidebar with "Restore" and "Delete forever" actions.

### "Local only" flag
- `folder_settings.local_only=1` excludes that subtree from manifest broadcasts and rejects incoming changes for paths inside it.

### Phase 2 deliverables
1. Two laptops can pair via PIN over Wi-Fi in under 30 seconds.
2. After pairing, all non-`local_only` files on each side replicate to the other; future changes propagate within a few seconds when both are online.
3. Changes made while disconnected sync correctly on reconnection.
4. Concurrent edits to the same file produce one winner and a conflict copy — no data loss.
5. Deleting on one device deletes on the other; both retain a recoverable copy in `.repsil/trash/` for 30 days.
6. Marking a folder "Local only" prevents it (and its contents) from leaving the device.

---

## Phase 3 — Installer + first release (sketch)

- **Installer:** NSIS via `electron-builder` (`electron-builder.yml`). Single `.exe` installer. Includes Tesseract binaries and `eng` + `ara` language packs, the Arabic-capable bundled font, app icon.
- **System tray:** background indicator, "Open Repsil", "Pause sync", "Quit".
- **Auto-start on login:** opt-in toggle in Settings.
- **First-run wizard:** language pick (EN/AR), choose root folder, optional "Pair another device" step.
- **Settings screen:** root path, language, theme, OCR defaults, auto-start, paired devices list (with "Unpair").
- **About / version / update check:** v1 ships *without* auto-update (YAGNI). Manual update via downloading a new installer.

### Phase 3 deliverables
1. `Repsil-Setup-X.Y.Z.exe` installs the app to `%LOCALAPPDATA%\Programs\Repsil`, adds a Start Menu entry and desktop shortcut.
2. First run shows the language picker and root-folder picker; choices persist across upgrades.
3. App can be made to start on login and minimize to tray.

---

## Out of scope for v1 (deliberately deferred)

- iOS/Android apps.
- Mac/Linux builds.
- Cloud anything.
- Auto-update.
- Multi-user accounts within one device.
- Custom per-folder metadata schemas (Notion-style).
- Document versioning beyond LWW + conflict copy (no full version history).
- Sharing with peers outside the trust ring (e.g. send a link to a non-paired user).
- E-signatures, annotations, redaction.
- Mobile companion for capturing scans.

---

## Risks & open issues

1. **OCR throughput** — Tesseract on CPU is the slowest part of the system. A user dumping a 1000-page scanned archive could take an hour to fully index. Mitigation: process OCR jobs in the background at low priority; UI shows queue progress; search works on already-indexed pages immediately.
2. **Arabic OCR quality** — Tesseract Arabic is decent but not great. Quality on faded or non-standard fonts may be poor. We commit to "best effort"; raw extracted text is searchable even if metadata auto-fill misses.
3. **Filesystem watcher edge cases on Windows** — Antivirus scans, network drives, OneDrive-managed folders all can cause spurious events or missed events with `chokidar`. We mitigate with a periodic full-tree reconcile (every 10 minutes by default) on top of live watching.
4. **mDNS on restrictive Wi-Fi networks** — Some public/hotel Wi-Fi blocks multicast. For v1 we accept this; Phase 2 settings includes a "Connect by IP" fallback (manual IP entry) for these cases.
5. **Bilingual UI complexity** — RTL is not just `dir="rtl"`. Many components (search, icons-with-text, date pickers) need explicit mirroring. We budget extra time in Phase 1 to do this properly the first time.
6. **TLS cert rotation** — v1 uses long-lived self-signed certs generated at install. Rotation is a future concern; we accept that re-installing the app means re-pairing.
7. **Large file performance** — Streaming for files >50 MB to keep memory bounded during sync transfer; chunked hashing to avoid loading entire files for diffs.

---

## End-to-end verification

### Phase 1
1. **Boot test:** Install dependencies (`npm install`), launch dev (`npm run dev`). App window opens; first-run wizard prompts for a root folder.
2. **Drop test (EN):** Place a digital English PDF (e.g. an invoice) into the root via Explorer. Within ~1s it appears in the dashboard with auto-filled title and (if detectable) document date. Search for a word from inside the PDF — document is returned.
3. **Drop test (AR):** Same as above with an Arabic-text PDF. Verify text is extracted in Arabic; search for an Arabic keyword returns the doc; UI shows Arabic content correctly.
4. **OCR test:** Right-click a folder → "Enable OCR for new files." Drop a scanned PDF into that folder. Within 5–30s (depends on page count) the document becomes searchable.
5. **Metadata edit:** Edit the title and document date for a doc. Restart the app — values persist. Trigger re-extraction (delete + re-add) — user-edited values are NOT overwritten.
6. **Search & filter:** Run keyword searches against extracted text, filter by date range and tags. Verify expected docs returned.
7. **RTL test:** Toggle language to Arabic. Sidebar moves right, layout mirrors, search bar text-aligns correctly, dates display sensibly.
8. **Watcher test:** Delete a file via Explorer. Dashboard updates within ~1s. Rename a file — metadata preserved (matched by content hash).

### Phase 2
1. **Pairing test:** Run the app on two laptops on the same Wi-Fi. Pair via PIN; confirm <30s end-to-end.
2. **Mirror test:** Drop a file on Laptop A → appears on Laptop B within seconds. Drop on B → appears on A.
3. **Offline test:** Disconnect Laptop B from Wi-Fi. Add 5 files on A, modify 1, delete 1. Reconnect B. All 5 adds, the edit, and the delete propagate correctly.
4. **Conflict test:** Disconnect. On both sides, modify the same file with different content. Reconnect. Both files present (winner + conflict copy with peer name and date in filename). No data loss.
5. **Trash test:** Delete a file on A. It disappears from B but appears in B's Trash view. Restore from B's Trash; file returns on both. After 30 days (simulate by editing `trashed_at`), sweep purges it.
6. **Local-only test:** Mark a folder local-only on A. Add files to it. B never receives them. Unmark; files start syncing.
7. **mTLS test:** Try to connect a third unpaired laptop on the same network — connection is rejected.

### Phase 3
1. Build the installer (`npm run dist`). Install on a clean Windows VM. Verify shortcuts, default install path, file associations (if any).
2. Launch from Start Menu. First-run wizard appears. Complete it. Restart the machine. With "Start on login" enabled, the app starts in the tray.
3. Uninstall via Settings → Apps. Verify the install directory is removed and (per user choice during uninstall) the user's archive root is **not** touched.

---

## Critical files to create (Phase 1 first)

- `package.json` (Electron 32+, React 18+, TypeScript 5+, `better-sqlite3`, `chokidar`, `pdf-parse`, `tesseract.js`, `react-i18next`, `bonjour-service` for Phase 2)
- `electron.vite.config.ts` (or equivalent) for the build pipeline (Vite + Electron-Vite is a good baseline)
- `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`
- `src/main/db/schema.sql`, `src/main/db/migrate.ts`, `src/main/db/queries.ts`
- `src/main/watcher/fileWatcher.ts`
- `src/main/extraction/{pdfText,ocr,language,metadata}.ts`
- `src/renderer/{App.tsx,index.tsx}` + `pages/*` + `components/*`
- `src/renderer/i18n/{en,ar}.json` and i18n config
- `resources/tessdata/{eng,ara}.traineddata`, `resources/fonts/<arabic-font>`

No existing code to reuse — greenfield project. Working directory is `d:\repsil` (currently empty).
