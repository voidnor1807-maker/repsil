import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  DbStatus,
  DocumentDetail,
  DocumentMetadataPatch,
  DocumentSummary,
  ExtractionQueueStatus,
  FolderNode,
  FolderSettings,
  HostResult,
  JoinResult,
  PickFolderResult,
  SearchFilters,
  SearchOptions,
  SearchResult,
  SyncStatus,
  Tag,
  TagWithUsage
} from '@shared/types'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', patch)
  },
  dialog: {
    pickFolder: (): Promise<PickFolderResult> =>
      ipcRenderer.invoke('dialog:pickFolder')
  },
  db: {
    status: (): Promise<DbStatus> => ipcRenderer.invoke('db:status')
  },
  documents: {
    listFolder: (folderRel: string): Promise<DocumentSummary[]> =>
      ipcRenderer.invoke('documents:listFolder', folderRel),
    get: (id: number): Promise<DocumentDetail | null> =>
      ipcRenderer.invoke('documents:get', id),
    search: (
      query: string,
      filters?: SearchFilters,
      options?: SearchOptions
    ): Promise<SearchResult[]> =>
      ipcRenderer.invoke('documents:search', query, filters, options),
    updateMetadata: (id: number, patch: DocumentMetadataPatch): Promise<DocumentDetail | null> =>
      ipcRenderer.invoke('documents:updateMetadata', id, patch),
    requestOcr: (id: number): Promise<boolean> =>
      ipcRenderer.invoke('documents:requestOcr', id),
    retry: (id: number): Promise<boolean> => ipcRenderer.invoke('documents:retry', id),
    setExtractedText: (id: number, text: string): Promise<boolean> =>
      ipcRenderer.invoke('documents:setExtractedText', id, text),
    openExternal: (relPath: string): Promise<string> =>
      ipcRenderer.invoke('documents:openExternal', relPath),
    revealInFolder: (relPath: string): Promise<void> =>
      ipcRenderer.invoke('documents:revealInFolder', relPath),
    /** Manual re-scan of the archive folder. Used as a recovery path when the
     *  OS file-system watcher misses an event (it can happen on Windows). */
    rescan: (): Promise<{ inserted: number; updated: number; removed: number; scanned: number }> =>
      ipcRenderer.invoke('documents:rescan'),
    /** Copy external files (drag from Explorer, etc.) into the archive under
     *  destFolderRel ('' = root). Returns per-file outcome. */
    import: (
      sources: string[],
      destFolderRel: string
    ): Promise<{ imported: string[]; skipped: Array<{ source: string; reason: string }> }> =>
      ipcRenderer.invoke('documents:import', sources, destFolderRel),
    /** Electron 32+ no longer exposes File.path; renderer must resolve dropped
     *  file paths through this bridge. Returns '' for non-file blobs. */
    resolveDroppedPath: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
    /** Fires when the watcher or sync adds/removes/changes a document. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('documents:changed', listener)
      return () => ipcRenderer.removeListener('documents:changed', listener)
    }
  },
  folders: {
    tree: (): Promise<FolderNode | null> => ipcRenderer.invoke('folders:tree')
  },
  folderSettings: {
    get: (folderRel: string): Promise<FolderSettings> =>
      ipcRenderer.invoke('folderSettings:get', folderRel),
    set: (settings: FolderSettings): Promise<FolderSettings> =>
      ipcRenderer.invoke('folderSettings:set', settings)
  },
  tags: {
    list: (): Promise<TagWithUsage[]> => ipcRenderer.invoke('tags:list'),
    forDocument: (id: number): Promise<Tag[]> => ipcRenderer.invoke('tags:forDocument', id),
    forDocuments: (ids: number[]): Promise<Record<number, string[]>> =>
      ipcRenderer.invoke('tags:forDocuments', ids),
    setForDocument: (id: number, names: string[]): Promise<Tag[]> =>
      ipcRenderer.invoke('tags:setForDocument', id, names)
  },
  extraction: {
    status: (): Promise<ExtractionQueueStatus> => ipcRenderer.invoke('extraction:status')
  },
  sync: {
    host: (): Promise<HostResult> => ipcRenderer.invoke('sync:host'),
    join: (code: string): Promise<JoinResult> => ipcRenderer.invoke('sync:join', code),
    stop: (): Promise<void> => ipcRenderer.invoke('sync:stop'),
    status: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:status'),
    setDeviceName: (name: string): Promise<AppSettings> =>
      ipcRenderer.invoke('sync:setDeviceName', name),
    /** Subscribe to live status pushes; returns an unsubscribe function. */
    onChanged: (cb: (status: SyncStatus) => void): (() => void) => {
      const listener = (_evt: unknown, status: SyncStatus): void => cb(status)
      ipcRenderer.on('sync:changed', listener)
      return () => ipcRenderer.removeListener('sync:changed', listener)
    }
  }
}

export type RepsilApi = typeof api

declare global {
  interface Window {
    repsil: RepsilApi
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('repsil', api)
  } catch (error) {
    console.error('Failed to expose repsil API to renderer:', error)
  }
} else {
  window.repsil = api
}
