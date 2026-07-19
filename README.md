# Repsil

A Windows-native local document archive with peer-to-peer LAN sync. No cloud, no
accounts, no server — your documents stay as real files on your disk, and syncing
happens directly between your own machines over the local network. Bilingual
English/Arabic throughout, including right-to-left layout.

## What it does

- **Archive a folder of documents.** Point Repsil at a folder; it watches it with
  a filesystem watcher and keeps an index in step with whatever is on disk.
- **Full-text search** over document contents and tags, backed by SQLite FTS5.
- **Automatic text extraction** — OCR for scanned images (English + Arabic), text
  extraction for PDFs, plus metadata and per-document language detection.
- **Peer-to-peer LAN sync.** Pair two machines with a short code over a secure
  channel and changes flow directly between them. No server is involved at any
  point.
- **Bilingual EN/AR** interface with full RTL support.
- **Windows installer** with auto-update.

Files on disk are the source of truth; the SQLite database is an index and search
layer over them.

## Tech stack

| Layer | Stack |
|---|---|
| Desktop shell | Electron 33, electron-vite, TypeScript (main / preload / renderer split) |
| UI | React 18, Tailwind CSS, Radix UI, framer-motion, lucide |
| Database & search | better-sqlite3 with FTS5 |
| File watching | chokidar |
| Extraction | tesseract.js (OCR), pdfjs-dist / pdf-parse, franc-min (language detection) |
| Localization | i18next / react-i18next, IBM Plex Sans + Sans Arabic |
| Packaging | electron-builder (`--win`), electron-updater, @napi-rs/canvas for icon generation |
| Tests | Vitest (colocated `*.test.ts`) |

## Project layout

```
src/main/        privileged core — db/, extraction/, search/, sync/, watcher/
src/preload/     IPC bridge between main and renderer
src/renderer/    React SPA — pages/, components/, i18n/, theme/, lib/
src/shared/      types shared across processes
resources/       bundled assets, including offline OCR language data
```

## Requirements

- **Windows 10 or 11**
- **Node.js 20 LTS or newer** — <https://nodejs.org>
- **Git** — <https://git-scm.com>
- *Only if step 2 below cannot find prebuilt binaries:* **Visual Studio Build
  Tools 2022** with the "Desktop development with C++" workload, to compile the
  native modules (`better-sqlite3`, `@napi-rs/canvas`). Most machines will not
  need this — prebuilt binaries are downloaded automatically.

## Setup

`node_modules/` is not committed (it is large and holds natively compiled
binaries). Clone, install, run:

```powershell
git clone https://github.com/voidnor1807-maker/repsil.git
cd repsil

npm install
npm run rebuild   # rebuild native modules against Electron's runtime
```

OCR language data (English + Arabic) ships in the repo under
`resources/tessdata/`, so OCR works fully offline with no extra download.

## Run

```powershell
npm run dev
```

The app window opens. On first run, pick a folder to use as your archive.

## Build a Windows installer

```powershell
npm run dist
```

The installer, plus an unpacked `win-unpacked\Repsil.exe` you can run directly,
land in `release/`. This is the way to get Repsil onto a machine that has no
Node or Git installed — build once, copy the installer over.

## Other commands

```powershell
npm run build       # production build (no installer)
npm run typecheck   # typecheck both the node and web tsconfigs
npm test            # run the Vitest suite once
npm run test:watch  # Vitest in watch mode
npm run icon        # regenerate the app icon
```

## Using LAN sync

1. Put both machines on the **same network**. Avoid guest networks or Wi-Fi with
   AP/client isolation — those block device-to-device traffic.
2. Open the **same archive** on both. The second machine can start from an empty
   folder and will adopt the first machine's archive on the initial sync. Two
   *different* non-empty archives refuse to sync, deliberately.
3. On machine A: **Wi-Fi icon** (top bar) → **Host** → **Start hosting** →
   **Copy** the pairing code. The first time, Windows Firewall will prompt —
   choose **Allow access** on private networks.
4. On machine B: **Wi-Fi icon** → **Join** → paste the code → **Connect**.

Once paired, dropping a file into A's archive indexes it on B, metadata edits
propagate both ways, and deletions replicate. A folder marked **"Don't sync
(local only)"** via its ⋮ menu never transfers.

**Conflicts:** if the same file is edited on both machines while disconnected,
the newer version wins and the older copy is kept alongside it, tagged
`conflict` — search that tag to find them.

**If two machines will not connect:** confirm both are on the same subnet (e.g.
both `192.168.1.x`), re-check that the firewall prompt was allowed on the *host*,
and note that some corporate or VPN networks block peer traffic entirely.

## Documentation

- `SETUP.md` — setting up on a second machine, and a fuller LAN sync test script
- `BUILD.md` — build and release details
