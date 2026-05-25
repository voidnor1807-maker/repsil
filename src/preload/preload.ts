import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, PickFolderResult } from '@shared/types'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', patch)
  },
  dialog: {
    pickFolder: (): Promise<PickFolderResult> =>
      ipcRenderer.invoke('dialog:pickFolder')
  }
}

export type RepsilApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('repsil', api)
  } catch (error) {
    console.error('Failed to expose repsil API to renderer:', error)
  }
} else {
  // @ts-expect-error window assignment when context isolation is off
  window.repsil = api
}
