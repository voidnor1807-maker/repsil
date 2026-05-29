# Running Repsil on another computer

> The npm packages are **not** stored in git (the `node_modules/` folder is huge
> and holds native binaries compiled for one specific machine). They are declared
> in `package.json` / `package-lock.json`, and you install them with one command.
> So: clone, install, run.

## Prerequisites (the test computer)

- **Windows 10/11**
- **Node.js 20 LTS or newer** — https://nodejs.org
- **Git** — https://git-scm.com
- *(Only if step 2 fails to find prebuilt binaries)* **Visual Studio Build Tools 2022**
  with the **“Desktop development with C++”** workload — needed to compile the
  native modules (`better-sqlite3`, `@napi-rs/canvas`). Most machines won't need
  this because prebuilt binaries are downloaded automatically.

## 1. Get the code

```powershell
git clone https://github.com/voidnor1807-maker/repsil.git
cd repsil
```

## 2. Install dependencies (this is "all the necessary packages")

```powershell
npm install
npm run rebuild   # rebuilds native modules for Electron's runtime
```

The OCR language data (English + Arabic) is already in the repo under
`resources/tessdata/`, so OCR works fully offline — no extra download.

## 3. Run it

```powershell
npm run dev
```

The app window opens. On first run, pick an archive folder.

---

## Optional: build a one-click installer (no dev tools on the 2nd machine)

If you'd rather not install Node/Git on the second computer, build a Windows
installer **once** on a machine that has the toolchain, then just copy it over:

```powershell
npm run build
npx electron-builder --win
```

The installer (and an unpacked `win-unpacked\Repsil.exe` you can run directly)
land in the `release\` folder. Copy that to the other computer and run it.

---

## Testing LAN sync across two computers

1. Put **both** computers on the **same network** (same Wi-Fi/router). Avoid
   "Guest" networks or Wi-Fi with *AP/client isolation* — those block
   device-to-device traffic.
2. On **both** computers, open the **same archive** (Computer B can start with an
   empty folder — it will adopt Computer A's archive on first sync). Two
   *different* non-empty archives will refuse to sync on purpose.
3. On Computer A: click the **Wi-Fi icon** (top bar) → **Host** → **Start hosting**
   → **Copy** the code.
   - The first time, **Windows Firewall** will ask to allow the app to accept
     connections — click **Allow access** (Private networks).
4. Send the code to Computer B (chat/email/etc.), then on B: **Wi-Fi icon** →
   **Join** → paste the code → **Connect**.
5. Try it:
   - Drop a PDF into A's archive folder → it appears and gets indexed on B.
   - Edit a title or tags on B → updates on A.
   - Delete a file on A → it's removed on B.
   - Mark a folder **“Don't sync (local only)”** (folder ⋮ menu) → it never transfers.
   - Edit the *same* file on both while disconnected, then connect → the newer
     wins and the older copy is kept beside it, tagged **`conflict`** (search the
     `conflict` tag to find it).

### If they can't connect
- Confirm both are on the same subnet (e.g. both `192.168.1.x`).
- Re-check the Windows Firewall prompt was allowed on the **host**.
- Some corporate/VPN networks block peer traffic — try a plain home network.
