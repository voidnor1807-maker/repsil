---
phase: code-review
reviewed: 2026-05-29T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - electron.vite.config.ts
  - vitest.config.ts
  - src/main/db/index.ts
  - src/main/db/migrate.ts
  - src/main/db/queries.ts
  - src/main/db/schema.ts
  - src/main/extraction/extract.ts
  - src/main/extraction/language.ts
  - src/main/extraction/metadata.ts
  - src/main/extraction/ocr.ts
  - src/main/extraction/pdfOcr.ts
  - src/main/extraction/pdfText.ts
  - src/main/extraction/queue.ts
  - src/main/extraction/scanDetect.ts
  - src/main/folders.ts
  - src/main/index.ts
  - src/main/ipc.ts
  - src/main/protocol.ts
  - src/main/renameTracker.ts
  - src/main/search/fts.ts
  - src/main/search/snippet.ts
  - src/main/settings.ts
  - src/main/watcher/fileWatcher.ts
  - src/main/watcher/paths.ts
  - src/main/watcher/reconcile.ts
  - src/preload/preload.ts
  - src/renderer/App.tsx
  - src/renderer/components/FolderTree.tsx
  - src/renderer/components/SearchFilters.tsx
  - src/renderer/components/SettingsSheet.tsx
  - src/renderer/components/TagInput.tsx
  - src/renderer/pages/Dashboard.tsx
  - src/renderer/pages/DocumentView.tsx
  - src/renderer/theme/theme.ts
  - src/shared/types.ts
findings:
  critical: 3
  warning: 9
  info: 6
  total: 18
status: issues_found
---

# Phase code-review: Code Review Report

**Reviewed:** 2026-05-29
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

This is a generally well-structured Electron app with good instincts about the renderer→main trust boundary: the FTS MATCH expression is sanitized, the filtered-search WHERE clause is fully parameterized, and the snippet renderer HTML-escapes before substituting `<mark>`. Context isolation and `nodeIntegration: false` are set correctly. However, the review surfaced several real defects:

- **The `repsil-file://` protocol handler is bypassable on Windows** because the relative-path escape check does not account for backslash-prefixed traversal segments and absolute-path normalization edge cases — this is the highest-value attack surface and is the focus of CR-01.
- **`documents:openExternal` and `documents:revealInFolder` accept an unvalidated `relPath` from the renderer** and join it straight onto the archive root with no traversal guard, allowing the renderer to open arbitrary files outside the archive via the OS shell.
- **The OCR worker recycle tears down the worker mid-lane without coordinating with the PDF-OCR loop**, creating a use-after-terminate race when `ocrPdf` issues many `ocrImage` calls in one job.

The remaining findings cover unhandled IPC rejections in the renderer (which surface as unhandled promise rejections and silent UI breakage), a FolderTree click handler that is dead code, and several robustness gaps in input validation and resource lifecycle.

## Critical Issues

### CR-01: `repsil-file://` path-traversal guard is incomplete on Windows

**File:** `src/main/protocol.ts:36-50`
**Issue:** The handler decodes `url.pathname`, strips leading slashes, then `join`s it onto `rootPath` and validates with `relative()`. Two gaps:

1. On Windows, a payload like `repsil-file://archive/..%5C..%5Cwindows%5Csystem32%5Cdrivers%5Cetc%5Chosts` decodes to `..\..\windows\...`. After `join`, `relative(rootPath, abs)` returns a string starting with `..\` — `inside.startsWith('..')` *does* catch the `..` prefix, but a crafted path that resolves to a sibling sharing a prefix (e.g. rootPath `C:\arc`, target `C:\arc-secrets\x`) yields `relative` = `..\arc-secrets\x`, which is correctly rejected — good. The genuine hole is **backslash-encoded segments combined with the leading-slash strip**: `replace(/^\/+/, '')` only strips forward slashes, so a value beginning with an encoded backslash or a UNC prefix (`\\server\share`) is passed into `join` and can produce an absolute UNC path. `isAbsolute` catches UNC, but `relative` of an absolute path on a *different* drive returns that absolute path, and the `isAbsolute(inside)` check is the only thing standing between the attacker and an arbitrary read. This logic is load-bearing and under-tested.
2. There is no `realpath`/symlink resolution: a symlink placed inside the archive that points outside it passes every check because `normalize` is purely lexical.

**Fix:** Resolve the real path and re-verify containment after symlink resolution; normalize separators before the leading-strip; reject any decoded segment containing `\`, `:` or a drive letter before joining:
```ts
const decoded = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '')
if (decoded.includes('\0') || /(^|[/\\])\.\.([/\\]|$)/.test(decoded) || /^[a-zA-Z]:/.test(decoded)) {
  return new Response(null, { status: 403 })
}
const abs = realpathSync(normalize(join(repsil.rootPath, decoded)))
const rootReal = realpathSync(repsil.rootPath)
const inside = relative(rootReal, abs)
if (inside.startsWith('..') || isAbsolute(inside)) return new Response(null, { status: 403 })
```
Add unit tests for `..\`, UNC, drive-letter, null-byte, and symlink inputs.

### CR-02: `openExternal` / `revealInFolder` join unvalidated renderer input with no traversal guard

**File:** `src/main/ipc.ts:137-147`
**Issue:** Both handlers take `relPath` directly from the renderer and do `join(current.rootPath, relPath)` then hand the result to `shell.openPath` / `shell.showItemInFolder`. There is **no containment check at all** — unlike the protocol handler, there is no `relative()` guard. A compromised or buggy renderer can pass `..\..\Windows\System32\calc.exe` (or any absolute path, since `join(root, 'C:\\evil')` on Windows yields `C:\evil`) and the main process will ask the OS shell to open it. `shell.openPath` on an executable / script is an arbitrary-program-launch primitive.

**Fix:** Reuse the same containment validation as the protocol handler before calling shell APIs:
```ts
function resolveInsideArchive(root: string, relPath: string): string | null {
  const abs = normalize(join(root, relPath))
  const inside = relative(root, abs)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null
  return abs
}
// then:
const abs = resolveInsideArchive(current.rootPath, relPath)
if (!abs) return 'invalid path'
return shell.openPath(abs)
```

### CR-03: OCR worker recycle races with the per-page PDF OCR loop (use-after-terminate)

**File:** `src/main/extraction/ocr.ts:72-90` and `src/main/extraction/pdfOcr.ts:71-92`
**Issue:** `ocrImage` increments `sinceRecycle` and, when it hits `RECYCLE_AFTER` (50), calls `await terminateOcr()` which sets `workerPromise = null`. `ocrPdf` calls `ocrImage` once per scanned page in a loop. A single large scanned PDF (>50 OCR pages) will trip the recycle *in the middle of its own loop*. While the queue is "serial," `terminateOcr` is invoked from inside an in-flight `ocrImage` call; the very next loop iteration calls `getWorker()` which lazily recreates the worker — so functionally it limps along, but the recycle was designed assuming "next job recreates the worker," not "next page in the same job." Worse, if a recognize call is ever issued against a worker that another path terminated (the queue's two lanes — `slowChain` — are serial, but `terminateOcr` is also called unconditionally on `will-quit` in `index.ts:88` while a slow-chain job may still be awaiting), `w.recognize` can be invoked on a terminated worker and reject or hang. The lifecycle has no mutex around create/terminate.

**Fix:** Do not terminate from inside `ocrImage`. Track recognition count and recycle *between queue jobs* (in `queue.ts` after `extractOne` resolves), or guard create/terminate with a single in-flight lock so terminate cannot interleave with an active recognize. On `will-quit`, await the active slow-chain promise before `terminateOcr()`.

## Warnings

### WR-01: Unhandled IPC promise rejections throughout the renderer

**File:** `src/renderer/pages/Dashboard.tsx:60-71, 78-87, 108-114`; `src/renderer/pages/DocumentView.tsx:70-87, 98-125`
**Issue:** Nearly every `window.repsil.*` call is awaited with no try/catch. IPC handlers in main can throw (e.g. `runFilteredSearch` preparing an invalid SQL, `setForDocument` transaction failure). A rejected invoke becomes an unhandled promise rejection inside a `setTimeout`/effect, the loading spinner never clears (`setLoading(true)` with no `finally`), and the UI silently wedges.
**Fix:** Wrap async IPC calls in try/catch (or a shared `safeInvoke` wrapper) and clear loading state in `finally`. At minimum, the debounced search effect must reset `setLoading(false)` on error.

### WR-02: `db.pragma('user_version = ...')` interpolates the version inside the migration transaction

**File:** `src/main/db/migrate.ts:9-15`
**Issue:** `m.version` is interpolated into the pragma string. It is currently sourced from a hardcoded constant array so it is not attacker-controlled, but the pattern is fragile and PRAGMA `user_version` set inside an explicit `transaction()` is not guaranteed to roll back with the surrounding DDL on all SQLite builds — if a later migration in the same `pending` batch throws, the user_version may already reflect a partially-applied earlier migration after rollback, leaving the schema and version inconsistent.
**Fix:** Set `user_version` to the highest applied version as the final statement, and rely on the fact that DDL inside a transaction rolls back together; or commit each migration version in its own transaction so a failure leaves a clean, known version.

### WR-03: `settings:update` does not await `drainPending` and leaves stale watcher/queue on failure

**File:** `src/main/ipc.ts:29-42`
**Issue:** On a rootPath change the handler opens a new DB, rebinds the queue, starts the watcher, and calls `drainPending()` (fire-and-forget enqueue). If `openDb` succeeds but `startWatcher` throws (e.g. permission error), the function rejects after the queue was already rebound to the new DB while no watcher is running, and the renderer gets a rejected promise with the app in a half-switched state. There is also no validation that `next.rootPath` is an existing directory before opening a DB inside it (`openDb` will `mkdirSync` `.repsil` anywhere the renderer names).
**Fix:** Validate the path is an existing directory the user picked; wrap the open/bind/watch sequence so a failure restores the previous archive or reports cleanly. Confirm `rootPath` originated from `dialog:pickFolder`.

### WR-04: `consumeMatchBySize` rename recovery can attach the wrong document's metadata

**File:** `src/main/renameTracker.ts:51-58`, used in `src/main/extraction/extract.ts:59`
**Issue:** The size-based fallback restores curated metadata (title, date, source, notes, user_edited_fields) onto a *different* file that merely happens to share a byte size with a recently deleted one, when only one snapshot has that size. Two unrelated PDFs of identical size within a 60s window (common for templated documents) will cause one file to silently inherit the other's metadata — a data-integrity defect that is hard to notice.
**Fix:** Gate the size fallback on additional signals (same extension AND same filename stem, or same size AND no hash available yet) and/or surface it to the user rather than applying silently. Prefer hash matching whenever the new file has been hashed.

### WR-05: Watcher reconcile and live `add` events can double-process / race on startup

**File:** `src/main/watcher/fileWatcher.ts:23-41`, `src/main/extraction/queue.ts:69-74`
**Issue:** `startWatcher` runs `reconcile()` (which inserts pending rows) before attaching chokidar with `ignoreInitial: true`, and `index.ts` calls `drainPending()` after. But `settings:update` calls `startWatcher` then `drainPending` separately; meanwhile chokidar `add`/`change` handlers call `enqueueExtraction` directly. The `queued` Set dedupes by id, but `bindQueue` (called just before `startWatcher` in both paths) clears `queued` and resets the chains — a job enqueued by an `add` event that fires during the initial reconcile window could be cleared and lost, or processed against `activeRepsil` after a rebind. The `if (activeRepsil !== repsil) return` guard drops jobs silently rather than re-binding them.
**Fix:** Establish a deterministic ordering: bind queue, run reconcile, attach watcher, then drain — and ensure `bindQueue` is never called after the watcher is live. Dropped jobs should fall back to the next periodic reconcile (they remain `pending` in DB, so `drainPending` will eventually catch them — verify this is intentional and documented).

### WR-06: `extractPdf` reads entire file into memory and `pdf-parse` has no page/size cap on the non-OCR path

**File:** `src/main/extraction/pdfText.ts:24-33`
**Issue:** `fs.readFile(absPath)` loads the whole PDF into a Buffer and hands it to `pdf-parse` with no size guard, unlike the OCR path which caps pages. A multi-GB or malformed PDF can exhaust memory or hang the fast lane (which is serial), starving all subsequent fast-lane extraction. (Flagged as correctness/robustness, not raw performance.)
**Fix:** Stat the file and skip / mark `failed` above a configurable byte threshold before reading; consider a timeout around the `pdf(buffer)` call.

### WR-07: `language.ts` dead branch — Arabic-script fallback unreachable when ratio between 0.05 and 0.3

**File:** `src/main/extraction/language.ts:31-45`
**Issue:** Inside `if (scriptTotal > 0)`, only `arabicRatio > 0.3` and `arabicRatio < 0.05` are handled. For a ratio in `[0.05, 0.3]` (mixed bilingual documents — the app's core use case), neither branch returns and control falls through to the bottom `franc` call on line 42, which re-runs detection redundantly. Not a crash, but the carefully-built script-ratio logic is bypassed exactly for the bilingual EN/AR documents this app targets, and franc-min on mixed scripts is unreliable.
**Fix:** Handle the middle band explicitly (e.g. treat `>= 0.15` as `ar`, else run franc once) and remove the redundant trailing franc call by restructuring into a single decision.

### WR-08: `Dashboard` queue-status poll restarts on every `results.length` change and can leak overlapping timers

**File:** `src/renderer/pages/Dashboard.tsx:105-120`
**Issue:** The poll effect depends on `results.length`. Each `loadMore` changes `results.length`, tearing down and restarting the poll. Because `tick` is async and schedules the next `setTimeout` *after* an awaited IPC call, the cleanup’s `clearTimeout(timer)` may run while `tick` is mid-await, after which the in-flight `tick` schedules a fresh timer that the (already-run) cleanup never clears — producing overlapping poll loops.
**Fix:** Remove `results.length` from the dependency array (poll independently), or guard the post-await scheduling with the `cancelled` flag (it already checks `cancelled` before `setQueueStatus` but not before scheduling the next `setTimeout`).

### WR-09: `toFtsMatchExpression` produces an empty/invalid MATCH for punctuation-only queries

**File:** `src/main/search/fts.ts:7-16`
**Issue:** Tokens are stripped of `"` then wrapped in `"..."`. A query consisting only of FTS operators or punctuation that unicode61 tokenizes away (e.g. `+ - ( )`) becomes phrases like `"+"` which FTS5 may treat as empty after tokenization, and `documents_fts MATCH '"+"'` can throw `fts5: syntax error` for some inputs, which propagates as an unhandled IPC rejection (see WR-01). Returning a non-null expression that the engine then rejects defeats the “short-circuit on empty” contract.
**Fix:** After building, validate each token contains at least one tokenizable character; drop tokens that don't; return null if none remain. Catch FTS errors in `runFilteredSearch` and return `[]` rather than throwing.

## Info

### IN-01: Dead/no-op code in FolderTree single-click handler

**File:** `src/renderer/components/FolderTree.tsx:66-69`
**Issue:** `if (hasChildren) setOpen((o) => o)` sets state to its current value — a no-op. Likely intended to expand on select.
**Fix:** Remove the line or implement the intended `setOpen(true)`.

### IN-02: `makeRepsilFileUrl` (protocol.ts) is unused; renderer duplicates the builder

**File:** `src/main/protocol.ts:55-58` vs `src/renderer/pages/DocumentView.tsx:34-36`
**Issue:** The exported `makeRepsilFileUrl` is never imported; `DocumentView` hand-rolls its own `makeFileUrl`. The two also differ subtly (both use `encodeURI`, but divergence risk is real and the dead export invites drift).
**Fix:** Delete the unused export or share one builder via `@shared`.

### IN-03: `DocumentView` retry/OCR polling uses recursive `setTimeout` with no cleanup on unmount

**File:** `src/renderer/pages/DocumentView.tsx:127-144, 162-181`
**Issue:** `poll()` chains `setTimeout` for up to 120s. If the user navigates back (`onBack`) the poll keeps running and calls `setDoc` on an unmounted component (React warning + wasted IPC). No `cancelled` flag as used elsewhere.
**Fix:** Track a cancellation ref cleared on unmount / back, and bail in `poll` if cancelled.

### IN-04: `IMAGE_EXTS` for preview includes `svg` and `gif` but OCR `OCR_IMAGE_EXTS` does not — silent inconsistency

**File:** `src/renderer/pages/DocumentView.tsx:32` vs `src/main/extraction/extract.ts:14` / `queue.ts:14`
**Issue:** The preview treats `svg`/`gif` as images (and renders SVG via `<img src=repsil-file://...>`), while extraction never OCRs them. SVG rendered from a local file is low-risk but worth noting; the diverging sets are a maintenance hazard.
**Fix:** Centralize the image-extension set in `@shared` and reference it from both sides.

### IN-05: Magic numbers scattered (poll intervals, TTL, recycle count, thresholds)

**File:** `src/main/renameTracker.ts:28`, `src/main/extraction/ocr.ts:40`, `src/renderer/pages/DocumentView.tsx:135,141`, `src/main/watcher/fileWatcher.ts:109`
**Issue:** `60_000`, `50`, `120_000`, `1500`, `10 * 60 * 1000` appear inline. Acceptable but ungrouped.
**Fix:** Hoist to named constants near the top of each module (some already are; align the rest).

### IN-06: `closeDb` / `openDb` does not checkpoint WAL or handle close failure

**File:** `src/main/db/index.ts:39-43`
**Issue:** `closeDb` calls `current.db.close()` with no try/catch and no WAL checkpoint; if close throws (busy handle), `current` is still set to null and the handle leaks. On archive switch this can leave `-wal`/`-shm` files.
**Fix:** Wrap in try/catch, run `PRAGMA wal_checkpoint(TRUNCATE)` before close, and null `current` in a `finally`.

---

_Reviewed: 2026-05-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
