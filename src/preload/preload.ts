import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DbStatus,
  DocumentDetail,
  DocumentMetadataPatch,
  DocumentSummary,
  ExtractionQueueStatus,
  FolderNode,
  FolderSettings,
  PickFolderResult,
  SearchFilters,
  SearchOptions,
  SearchResult,
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
      ipcRenderer.invoke('documents:revealInFolder', relPath)
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
