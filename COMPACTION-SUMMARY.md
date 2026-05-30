# Repsil — Conversation Compaction Summary

> Snapshot of project state and conversation history as of **2026-05-29**.
> Repsil is a Windows-native Electron desktop app: a local document archive with LAN sync, no cloud, bilingual EN/AR.

---

## 1. Project Overview & Intent

Repsil follows a 3-phase plan:

- **Phase 1:** Local archive (DONE)
- **Phase 2:** Pairing + LAN sync
- **Phase 3:** Installer

This conversation built out **all of Phase 1** plus fixed 22 reported issues and bundled OCR language assets.

### Specific feature directives from the user
1. Write **rename-matching logic** (recover metadata when a file is renamed).
2. **Scan the entire document** for sender keywords like "to" / "source" / "from".
3. Handle **Iraqi date format** `2026/5/27` (YYYY/MM/DD).
4. Bundle **Arabic OCR** for better accuracy.

---

## 2. Key Technical Concepts

- Electron 33 (main/preload/renderer), electron-vite, contextBridge IPC bridge
- better-sqlite3 (native module, synchronous, rebuilt for Electron via `electron-builder install-app-deps`)
- SQLite FTS5 full-text search with `unicode61 remove_diacritics 2` tokenizer; `snippet()` function
- Schema migrations via `PRAGMA user_version` (3 migrations)
- chokidar file watcher with `awaitWriteFinish`; full-tree reconcile backstop
- pdf-parse (digital PDF text); tesseract.js (OCR, eng+ara, own worker); pdfjs-dist legacy build + @napi-rs/canvas (scanned-PDF rendering); franc-min (language detection)
- React 18, Radix UI (dialog, popover, context-menu, dropdown-menu), framer-motion, Tailwind (darkMode: 'class'), react-i18next with RTL
- Vitest for TDD; Visual Studio Build Tools 2022 (winget install)
- Custom `repsil-file://` privileged protocol with path-allowlist security
- Two-lane extraction queue (fast text vs slow OCR)
- XSS prevention via sentinel-char snippets + HTML escaping

---

## 3. Files & Code Sections

### Main process — Database
- **src/main/db/schema.ts** — Versioned `MIGRATIONS` array.
  - `M1_INITIAL`: documents, tags, document_tags, folder_settings, documents_fts virtual table + insert/update/delete triggers.
  - `M2_EXTRACTION_REPORTING`: adds `error_message`, `ocr_pages_done`, `ocr_pages_total` columns.
  - `M3_APP_SETTINGS`: `app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)` for C2 archive-scoped settings.
- **src/main/db/queries.ts** — `createQueries(db)` factory. `DocumentRow` includes error_message/ocr_pages_done/ocr_pages_total. Statements: insertDocument, getDocumentByRelPath, listDocumentsInFolder, deleteDocumentByRelPath, updateDocumentMtime, updateExtraction, updateMetadataFields, updateUserMetadata, restoreFromRename, getDocumentById, findPendingDocuments, setOcrRequested, requeueDocument, setExtractedText, countByStatus, countDocuments, searchDocuments, listTags, getTagsForDocument, upsertTag (RETURNING id), clearDocumentTags, linkTag, pruneUnusedTags, getFolderSettings, upsertFolderSettings, listAllFolderSettings, listAppSettings, setAppSetting.
- **src/main/db/index.ts** — `openDb(rootPath)` creates `<root>/.repsil/repsil.db`, sets WAL/foreign_keys/synchronous, runs migrations; `getDb`, `closeDb`.

### Main process — Settings
- **src/main/settings.ts** — `DEFAULTS = {language:'en', theme:'dark', dateFormat:'dmy', pdfOcrMaxPages:200, rootPath:null, firstRunComplete:false}`. `ARCHIVE_KEYS = ['dateFormat','pdfOcrMaxPages']`. `loadSettings` (userData JSON), `loadArchiveSettings` (overlays DB values), `getSettings`, `updateSettings` (writes userData + archive keys to DB).

### Main process — IPC
- **src/main/ipc.ts** — `registerIpcHandlers` with: settings:get/update, dialog:pickFolder, documents:listFolder/get/search/updateMetadata/requestOcr/retry/openExternal/revealInFolder/setExtractedText, db:status, extraction:status, folders:tree, folderSettings:get/set, tags:list/forDocument/forDocuments/setForDocument. Helper `runFilteredSearch(db, rawQuery, filters, options)` builds dynamic SQL with anyTag (AND/OR), date range, exts, tagIds, folderRel, pagination, sentinel chars + renderSnippet.

### Main process — Search
- **src/main/search/snippet.ts** — `MATCH_START = String.fromCharCode(1)`, `MATCH_END = String.fromCharCode(2)`. `renderSnippet` escapes `&<>"'` then swaps sentinels for `<mark>`/`</mark>`.
- **src/main/search/fts.ts** — `toFtsMatchExpression(raw)`: tokenizes, strips `"`, quotes each token, returns null if empty.

### Main process — Extraction
- **src/main/extraction/metadata.ts** — `guessMetadata(text, filename, opts?:{dateFormat})`. `DateFormat='dmy'|'mdy'`. candidateDates handles YYYY-first (Iraqi/ISO), day-first/month-first by dateFormat, EN+AR written months, normalizeDigits (Arabic-Indic). `guessSource` scans whole doc for From/Source/Sender/Issued by (EN) and من/المرسل/المصدر/صادر عن (AR), excludes "To:"/recipient labels.
- **src/main/extraction/language.ts** — `detectLanguage` (Unicode script + franc-min).
- **src/main/extraction/extract.ts** — `extractOne(repsil, id)`: sha256 hash, rename recovery via `consumeMatch(hash) ?? consumeMatchBySize(stat.size)`, cache check, PDF branch (ocr_requested→ocrPdf hybrid; else extractPdf), image branch (ocrImage if ocr_requested), captures errorMessage/ocrPagesDone/ocrPagesTotal, applyMetadataGuess with dateFormat from getSettings().
- **src/main/extraction/ocr.ts** — `LANGS='eng+ara'`, `RECYCLE_AFTER=50`. `resolveLangConfig()` returns langPath/cachePath/gzip — checks resources/tessdata for eng+ara.traineddata, falls back to userData cache+CDN. `ocrImage(input:string|Buffer)`, recycles worker after 50 jobs via terminateOcr.
- **src/main/extraction/pdfOcr.ts** — `ocrPdf(absPath, {maxPages})`. Pass 1: per-page getTextContent → charCounts. classifyPdfPages decides ocrPages. Pass 2: render+OCR only empty pages via @napi-rs/canvas at RENDER_SCALE=2.0. Returns {text, pagesProcessed, totalPages, truncated, ocrPageCount}. DEFAULT_MAX_PAGES=200.
- **src/main/extraction/scanDetect.ts** — `classifyPdfPages(perPageCharCounts)`: MIN_CHARS_PER_PAGE=8. Returns {kind:'digital'|'scanned'|'partial', ocrPages:number[]}.
- **src/main/extraction/queue.ts** — Two-lane (fastChain/slowChain). isOcrJob (image ext OR pdf+ocr_requested). bindQueue, unbindQueue, enqueueExtraction, drainPending, queueStatus.

### Main process — Watcher / Folders / Protocol / Rename
- **src/main/renameTracker.ts** — Array of RenameSnapshot. TTL_MS=60000. recordDeletion, consumeMatch(hash), consumeMatchBySize(size) — only matches if exactly one same-size snapshot, prune, clearAll.
- **src/main/folders.ts** — buildFolderTree(repsil) → FolderNode tree, inheritsFolderFlag(repsil, fileRelPath, flag) walks ancestors.
- **src/main/watcher/reconcile.ts** — Chunked (CHUNK=500) upsert + remove transactions with yieldToLoop() between chunks. Sets ocr_requested for inherited folder OCR.
- **src/main/watcher/fileWatcher.ts** — startWatcher/stopWatcher. unlink records deletion snapshot. Insert sets ocr_requested if inheritsFolderFlag.
- **src/main/watcher/paths.ts** — toRel, extOf, isIgnoredRel.
- **src/main/protocol.ts** — repsil-file:// scheme, path allowlist (inside rootPath, not .repsil/).
- **src/main/index.ts** — Startup: openDb→loadArchiveSettings→bindQueue→startWatcher→drainPending. will-quit: stopWatcher→unbindQueue→terminateOcr→closeDb.

### Preload / Shared types
- **src/preload/preload.ts** — Full `window.repsil` API: settings, dialog, db, documents, folders, folderSettings, tags, extraction.
- **src/shared/types.ts** — AppSettings (+theme, dateFormat, pdfOcrMaxPages), Theme, DateFormat, FolderNode, FolderSettings, Tag, TagWithUsage, SearchFilters (+anyTag), SearchOptions, SearchResult, DocumentDetail, DocumentSummary, ExtractionStatus.

### Renderer
- **src/renderer/pages/Dashboard.tsx** — PAGE_SIZE=100. Sidebar FolderTree, search box, SearchFilters, settings button, paginated results with Load more, batch tags via tags.forDocuments, failed badges, lazy DocumentView+SettingsSheet.
- **src/renderer/pages/DocumentView.tsx** — viewer (iframe PDF / img / no-preview), editable metadata fields, TagInput, editable extracted-text textarea, Open/Reveal buttons, error banner + Retry, Run OCR button.
- **src/renderer/components/** — FolderTree.tsx (ContextMenu + DropdownMenu kebab), TagInput.tsx, SearchFilters.tsx (popover, AND/OR toggle), SettingsSheet.tsx (Dialog: language/theme/dateFormat/pdfOcrMaxPages).
- **src/renderer/theme/theme.ts** — applyTheme(theme) toggles dark/light class.

### Build config
- **electron-builder.yml** — asarUnpack (**/*.node, better-sqlite3, @napi-rs, tesseract.js, tesseract.js-core, pdfjs-dist) + extraResources (resources/tessdata→tessdata, *.traineddata filter).
- **electron.vite.config.ts** — renderer manualChunks {react, i18n, motion}.
- **vitest.config.ts** — aliases @main/@shared/@renderer, node environment.
- **resources/tessdata/** — README.md + eng.traineddata (14.7 MB, tessdata_best) + ara.traineddata (12 MB, tessdata_best).

---

## 4. Errors Encountered & Fixes

- Control chars (\x01/\x02) stripped from snippet.ts literals → fixed with `String.fromCharCode(1/2)`.
- ipc.ts fragmented when extracting helper (orphaned db:status handler) → rewrote ipc.ts cleanly.
- Duplicate `enqueueExtraction` import → consolidated.
- Unused-import/var typecheck errors → removed.
- pdfjs invalid `isEvalSupported` option → removed.
- Network DNS failures (github.com / npm EAI_AGAIN) → retried on user prompt when network recovered (no sleep loops).
- No critical user corrections to approach; user repeatedly said "Continue the plan" approvingly.

---

## 5. Problem Solving / Verification

- Established SQLite toolchain (VS Build Tools 2022; better-sqlite3 prebuilt binary worked).
- Built all of Phase 1: DB, watcher, extraction (digital PDF + image OCR + scanned-PDF hybrid OCR), search (FTS5+filters+pagination), folder tree, tags, document viewer/editor, settings, EN/AR i18n with RTL.
- Fixed all 22 reported issues (C1, C2, E1-E5, F1-F5, P1-P5, K1-K3, T1) using TDD for pure logic.
- **Verification:** 46 Vitest tests pass, `npm run typecheck` clean, `npm run build` clean. NOT verified via live Electron UI run (cannot drive the window from this environment).
- C2 implemented as: archive-scoped settings (dateFormat, pdfOcrMaxPages) in DB app_settings; machine prefs in userData; merged via loadArchiveSettings.

---

## 6. OCR Language Assets (most recent work)

Downloaded `tessdata_best` models from `https://github.com/tesseract-ocr/tessdata_best/raw/main` into `resources/tessdata/`:

| File | Model | Size |
|------|-------|------|
| eng.traineddata | tessdata_best | 14.7 MB |
| ara.traineddata | tessdata_best | 12 MB |

Best (float-LSTM) models = better Arabic accuracy, slightly slower per page. Picked up automatically by `resolveLangConfig` (gzip:false, raw uncompressed files) and shipped via electron-builder extraResources. Closes K1 with real assets.

---

## 7. Pending / Outstanding (not re-requested)

- Commit the work (not yet committed — only commit is `57bef44 Initial scaffold`).
- Live UI verification via `npm run dev`.
- `/code-review` on the diff (previously offered, not accepted).
- Optional: re-run `npm run build` to confirm build passes with traineddata present.

---

## 8. Full User Message History

1. "this project is unfinished, can you retrieve the plans for this project?"
2. [pasted plan] "i found the plan, can you exactly mark where the plan stopped... what to install SQL on? it was vs code etc..."
3. "do you have all the context you need to carry on?"
4. "1. the sqlite from vs code / 2. check whether this computer has the requirements"
5. "B"
6. "Tell me what should I do next. Install the SQLite or start the scaffolding."
7. "start"
8. "Continue the plan"
9. "continue the plan"
10. [pasted deviation notes] "explain the text simply"
11. "2- write the matching logic / 3- scan the entire document and search for keywords like 'to' or 'source' or 'from'. / 4- The dates in Iraq is like 2026/5/27 / after that, continue the plan."
12. "Continue the plan."
13. "CONTINUE!"
14. "finish all the contents of phase one and give me a detailed report of all the possible issues"
15. "Continue from where you left off."
16. "give me a report with a great solution for each issue you mentioned"
17. "i want you to explain these issues in plain language so i can understand the solution, and give me a percentage of the quality for solution"
18. "fix all issues, using all skills with the highest code quality"
19. "download the packages for k1,k2,k3"
20. "download them now"
21. "download the packages and with arabic for better accuracy"

---

## 9. Environment

- Primary working dir: `c:\Users\user\repsil`
- Git repo: yes, branch `main`, single commit `57bef44 Initial scaffold: Phase 1 wizard + design framework`
- Platform: win32 / Windows 11 Home
- Shell: PowerShell
- Full transcript: `C:\Users\user\.claude\projects\c--Users-user-repsil\02ea52a4-0361-46a5-83f2-9d1a9c88d9c3.jsonl`
