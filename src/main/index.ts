import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { loadArchiveSettings, loadSettings } from './settings'
import { closeDb, openDb } from './db'
import { bindQueue, drainPending, unbindQueue } from './extraction/queue'
import { terminateOcr } from './extraction/ocr'
import { registerProtocolHandlers, registerProtocolSchemes } from './protocol'
import { startWatcher, stopWatcher } from './watcher/fileWatcher'
import { stopSync } from './sync/manager'
import { sweepTrash } from './trash'
import { getDb } from './db'
import { initAutoUpdate } from './updater'

registerProtocolSchemes()

// 30-day retention for shared trash. Sweeper runs hourly while the app is up;
// any trash file older than the window is purged from disk and its tombstone
// row deleted so peers eventually stop replicating the deletion record.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const TRASH_SWEEP_INTERVAL_MS = 60 * 60 * 1000

let mainWindow: BrowserWindow | null = null
let trashSweepTimer: ReturnType<typeof setInterval> | null = null

function isDev(): boolean {
  return !app.isPackaged
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0d14',
    title: 'Repsil',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isDev()) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev() && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.repsil.app')
  registerProtocolHandlers()

  const settings = await loadSettings()
  if (settings.rootPath) {
    try {
      const repsil = openDb(settings.rootPath)
      loadArchiveSettings()
      bindQueue(repsil)
      await startWatcher(repsil)
      drainPending()
    } catch (err) {
      console.error('Failed to open archive at startup:', err)
    }
  }
  registerIpcHandlers()
  // Sweep trash once on startup, then hourly. Lookup is by-db each tick so
  // changing the open archive at runtime is handled without restarting.
  const tick = (): void => {
    const repsil = getDb()
    if (!repsil) return
    void sweepTrash(repsil, TRASH_RETENTION_MS).catch((err) =>
      console.error('trash sweep failed:', err)
    )
  }
  tick()
  trashSweepTimer = setInterval(tick, TRASH_SWEEP_INTERVAL_MS)
  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async (event) => {
  event.preventDefault()
  if (trashSweepTimer) {
    clearInterval(trashSweepTimer)
    trashSweepTimer = null
  }
  await stopSync()
  await stopWatcher()
  unbindQueue()
  await terminateOcr()
  closeDb()
  app.exit(0)
})
