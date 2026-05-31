# Building Repsil

## Commands

```bash
npm run build      # compile main + preload + renderer into out/
npm run dist       # build + package a Windows NSIS installer into release/
```

`npm run dist` produces:

- `release/Repsil Setup <version>.exe` — the installer (one-click, per-user, unsigned)
- `release/Repsil Setup <version>.exe.blockmap` + `release/latest.yml` — delta/update metadata
- `release/win-unpacked/` — the unpacked app (run `Repsil.exe` directly to test without installing)

## Verifying a packaged build

`scripts/verify-packaged.cjs` exercises the **packaged** native modules against
Electron's real ABI (better-sqlite3 + FTS5, @napi-rs/canvas) and checks that the
OCR `tessdata` shipped. Run it against the unpacked build:

```bash
ELECTRON_RUN_AS_NODE=1 ./release/win-unpacked/Repsil.exe scripts/verify-packaged.cjs
```

Note: it requires modules via the `app.asar` virtual path on purpose — that's how
the real app loads them (Electron resolves `bindings` inside the asar and pulls the
native `.node` from `app.asar.unpacked`). Requiring from the physical
`app.asar.unpacked` path gives a false "Cannot find module 'bindings'" failure.

## GOTCHA: winCodeSign "Cannot create symbolic link" on Windows

On a clean machine, `npm run dist` may fail while extracting electron-builder's
`winCodeSign` vendor archive:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
       ...winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
⨯ cannot execute  cause=exit status 2
```

The failing symlinks are **macOS** signing libs that a Windows build never uses,
but electron-builder treats the nonzero 7-Zip exit as fatal and never produces the
installer. Creating symlinks on Windows needs a privilege a normal shell lacks.

**Permanent fix (recommended):** enable **Windows Developer Mode**
(Settings → Privacy & security → For developers → Developer Mode = On). This grants
the symlink privilege to your user account; afterwards `npm run dist` just works.
Requires admin once.

**Admin-free fix (what's currently applied on this machine):** pre-extract the
archive into the cache *without* symlinks, so app-builder finds it already present
and skips its own (failing) extraction:

```bash
# 7za x (no -snl* flags) skips the macOS symlinks instead of force-creating them
node_modules/7zip-bin/win/x64/7za.exe x \
  "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/<downloaded>.7z" \
  -o"$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" -y
```

The cache persists, so this is a one-time action per machine. CI will hit the same
wall — enable Developer Mode on the runner, or script the pre-extract above.

## App icon

`build/icon.ico` is generated from `scripts/make-icon.cjs` (an "R" lettermark in
the brand palette). Regenerate after a palette/design change:

```bash
npm run icon
```

## Releasing an update (auto-update via GitHub Releases)

The packaged app checks `github.com/voidnor1807-maker/repsil` Releases on launch
(and every 6h), downloads a newer version silently, and installs it on next quit.
So shipping a change to the brother is: **bump version → publish → he restarts.**

One-time setup:

1. Create a **GitHub Personal Access Token** (classic) with the `repo` scope:
   GitHub → Settings → Developer settings → Personal access tokens. Copy it.
2. Make it available to the build (PowerShell):
   ```powershell
   $env:GH_TOKEN = "ghp_xxxxxxxx"
   ```

Each release:

```powershell
npm version patch        # bumps 0.1.0 -> 0.1.1 in package.json (and git tag)
npm run release          # builds + uploads installer + latest.yml to GitHub Releases
```

`npm run release` creates a **draft** GitHub Release by default — open the repo's
Releases page and click **Publish** so the brother's app can see it. (Auto-update
on Windows works fine with an **unsigned** installer; signing is not required.)

Plain `npm run dist` still works for local-only builds (no upload, no token).

## Still deferred

- **Code signing** — installer is unsigned, so Windows SmartScreen shows a
  one-time "unknown publisher" warning on first install. Fine for personal use;
  needs a paid certificate to remove. Does **not** affect auto-update.
