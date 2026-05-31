import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

// Check on launch, then periodically while the app stays open.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Wire GitHub-Releases auto-update. New versions download silently in the
 * background and install on the next app quit (so the user is never
 * interrupted; they just have the latest version after a restart).
 *
 * Degrades gracefully: in dev (unpackaged) there is no update feed, so we
 * no-op. Any network/feed error is swallowed — a failed update check must
 * never crash or block the app, which is critical for an offline-first,
 * LAN-only tool that may have no internet at all.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('auto-update error:', err?.message ?? err)
  })
  autoUpdater.on('update-available', (info) => {
    console.log('auto-update: downloading', info.version)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('auto-update: ready, will install on quit', info.version)
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('auto-update check failed:', err?.message ?? err)
    })
  }

  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
