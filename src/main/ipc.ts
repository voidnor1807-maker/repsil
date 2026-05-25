import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { AppSettings, PickFolderResult } from '@shared/types'
import { getSettings, updateSettings } from './settings'

export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', (): AppSettings => getSettings())

  ipcMain.handle(
    'settings:update',
    async (_evt, patch: Partial<AppSettings>): Promise<AppSettings> => {
      return updateSettings(patch)
    }
  )

  ipcMain.handle(
    'dialog:pickFolder',
    async (event): Promise<PickFolderResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: 'Choose your archive folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, path: null }
      }
      return { canceled: false, path: result.filePaths[0] }
    }
  )
}
