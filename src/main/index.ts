import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { loadArchiveSettings, loadSettings } from './settings'
import { closeDb, openDb } from './db'
import { bindQueue, drainPending, unbindQueue } from './extraction/queue'
import { terminateOcr } from './extraction/ocr'
import { registerProtocolHandlers, registerProtocolSchemes } from './protocol'
import { startWatcher, stopWatcher } from './watcher/fileWatcher'

registerProtocolSchemes()

let mainWindow: BrowserWindow | null = null

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
      nodeIntegration: false
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async (event) => {
  event.preventDefault()
  await stopWatcher()
  unbindQueue()
  await terminateOcr()
  closeDb()
  app.exit(0)
})
