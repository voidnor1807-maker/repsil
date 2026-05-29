import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import { resolveInsideArchive } from './pathSafety'
import {
  joinSession,
  onSyncChange,
  startHosting,
  stopSync,
  syncStatus
} from './sync/manager'
import type {
  AppSettings,
  DbStatus,
  DocumentMetadataPatch,
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
  TagWithUsage,
  UserEditableField
} from '@shared/types'
import { buildFolderTree } from './folders'
import { toFtsMatchExpression } from './search/fts'
import { renderSnippet } from './search/snippet'
import { getSettings, loadArchiveSettings, updateSettings } from './settings'
import { getDb, openDb } from './db'
import { bindQueue, drainPending, enqueueExtraction, queueStatus } from './extraction/queue'
import { startWatcher } from './watcher/fileWatcher'
import type { DocumentRow } from './db/queries'

export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', (): AppSettings => getSettings())

  ipcMain.handle(
    'settings:update',
    async (_evt, patch: Partial<AppSettings>): Promise<AppSettings> => {
      // Validate a new archive folder BEFORE persisting it, so a bad path never
      // gets written to settings.json (WR-03).
      if (patch.rootPath != null) {
        let isDir = false
        try {
          isDir = statSync(patch.rootPath).isDirectory()
        } catch {
          isDir = false
        }
        if (!isDir) throw new Error('Selected archive folder does not exist')
      }

      const next = await updateSettings(patch)
      if (next.rootPath) {
        try {
          const repsil = openDb(next.rootPath)
          loadArchiveSettings()
          bindQueue(repsil)
          await startWatcher(repsil)
          drainPending()
        } catch (err) {
          console.error('Failed to switch archive:', err)
          throw err instanceof Error ? err : new Error(String(err))
        }
      }
      return next
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

  ipcMain.handle('documents:listFolder', (_evt, folderRel: string): DocumentRow[] => {
    const current = getDb()
    if (!current) return []
    const prefix = folderRel === '' || folderRel === '/' ? '' : folderRel.replace(/\/?$/, '/')
    return current.queries.listDocumentsInFolder.all(prefix, prefix) as DocumentRow[]
  })

  ipcMain.handle('documents:get', (_evt, id: number): DocumentRow | null => {
    const current = getDb()
    if (!current) return null
    return (current.queries.getDocumentById.get(id) as DocumentRow | undefined) ?? null
  })

  ipcMain.handle(
    'documents:updateMetadata',
    (_evt, id: number, patch: DocumentMetadataPatch): DocumentRow | null => {
      const current = getDb()
      if (!current) return null
      const row = current.queries.getDocumentById.get(id) as DocumentRow | undefined
      if (!row) return null

      const fields: UserEditableField[] = ['title', 'doc_date', 'source', 'notes']
      const merged: Record<UserEditableField, string | null> = {
        title: row.title,
        doc_date: row.doc_date,
        source: row.source,
        notes: row.notes
      }
      const edited = new Set<UserEditableField>(safeParseFields(row.user_edited_fields))

      for (const f of fields) {
        if (f in patch) {
          const v = patch[f]
          merged[f] = normalizeEmpty(v)
          edited.add(f)
        }
      }

      current.queries.updateUserMetadata.run({
        id,
        title: merged.title,
        doc_date: merged.doc_date,
        source: merged.source,
        notes: merged.notes,
        user_edited_fields: JSON.stringify([...edited]),
        meta_updated_at: Date.now(),
        last_writer: getSettings().deviceId
      })
      return (current.queries.getDocumentById.get(id) as DocumentRow | undefined) ?? null
    }
  )

  ipcMain.handle(
    'documents:search',
    (_evt, rawQuery: string, filters?: SearchFilters, options?: SearchOptions): SearchResult[] => {
      const current = getDb()
      if (!current) return []
      return runFilteredSearch(current.db, rawQuery, filters ?? {}, options ?? {})
    }
  )

  ipcMain.handle(
    'documents:setExtractedText',
    (_evt, id: number, text: string): boolean => {
      const current = getDb()
      if (!current) return false
      const trimmed = text.trim()
      current.queries.setExtractedText.run({ id, extracted_text: trimmed || null })
      return true
    }
  )

  ipcMain.handle('documents:retry', (_evt, id: number): boolean => {
    const current = getDb()
    if (!current) return false
    current.queries.requeueDocument.run(id)
    enqueueExtraction(id)
    return true
  })

  ipcMain.handle('documents:openExternal', async (_evt, relPath: string): Promise<string> => {
    const current = getDb()
    if (!current) return 'no archive open'
    const abs = resolveInsideArchive(current.rootPath, relPath)
    if (!abs) return 'invalid path'
    return shell.openPath(abs)
  })

  ipcMain.handle('documents:revealInFolder', (_evt, relPath: string): void => {
    const current = getDb()
    if (!current) return
    const abs = resolveInsideArchive(current.rootPath, relPath)
    if (!abs) return
    shell.showItemInFolder(abs)
  })

  ipcMain.handle('extraction:status', () => queueStatus())

  ipcMain.handle('documents:requestOcr', (_evt, id: number): boolean => {
    const current = getDb()
    if (!current) return false
    const row = current.queries.getDocumentById.get(id) as DocumentRow | undefined
    if (!row) return false
    current.queries.setOcrRequested.run(id)
    enqueueExtraction(id)
    return true
  })

  ipcMain.handle('folderSettings:get', (_evt, folderRel: string): FolderSettings => {
    const current = getDb()
    if (!current) return { rel_path: folderRel, ocr_default: false, local_only: false }
    const row = current.queries.getFolderSettings.get(folderRel)
    if (!row) return { rel_path: folderRel, ocr_default: false, local_only: false }
    return {
      rel_path: row.rel_path,
      ocr_default: row.ocr_default === 1,
      local_only: row.local_only === 1
    }
  })

  ipcMain.handle(
    'folderSettings:set',
    (_evt, settings: FolderSettings): FolderSettings => {
      const current = getDb()
      if (!current) return settings
      current.queries.upsertFolderSettings.run({
        rel_path: settings.rel_path,
        ocr_default: settings.ocr_default ? 1 : 0,
        local_only: settings.local_only ? 1 : 0
      })
      return settings
    }
  )

  ipcMain.handle('folders:tree', async (): Promise<FolderNode | null> => {
    const current = getDb()
    if (!current) return null
    return buildFolderTree(current)
  })

  ipcMain.handle('tags:list', (): TagWithUsage[] => {
    const current = getDb()
    if (!current) return []
    return current.queries.listTags.all() as TagWithUsage[]
  })

  ipcMain.handle('tags:forDocument', (_evt, id: number): Tag[] => {
    const current = getDb()
    if (!current) return []
    return current.queries.getTagsForDocument.all(id) as Tag[]
  })

  ipcMain.handle(
    'tags:forDocuments',
    (_evt, ids: number[]): Record<number, string[]> => {
      const current = getDb()
      if (!current || ids.length === 0) return {}
      const placeholders = ids.map(() => '?').join(',')
      const rows = current.db
        .prepare(
          `SELECT dt.document_id AS documentId, t.name AS name
             FROM document_tags dt
             JOIN tags t ON t.id = dt.tag_id
            WHERE dt.document_id IN (${placeholders})
            ORDER BY t.name COLLATE NOCASE`
        )
        .all(...ids) as { documentId: number; name: string }[]
      const map: Record<number, string[]> = {}
      for (const r of rows) {
        ;(map[r.documentId] ??= []).push(r.name)
      }
      return map
    }
  )

  ipcMain.handle(
    'tags:setForDocument',
    (_evt, id: number, names: string[]): Tag[] => {
      const current = getDb()
      if (!current) return []
      const tx = current.db.transaction(() => {
        current.queries.clearDocumentTags.run(id)
        const seen = new Set<string>()
        for (const raw of names) {
          const name = raw.trim()
          if (!name || seen.has(name.toLowerCase())) continue
          seen.add(name.toLowerCase())
          const { id: tagId } = current.queries.upsertTag.get(name) as { id: number }
          current.queries.linkTag.run({ document_id: id, tag_id: tagId })
        }
        current.queries.pruneUnusedTags.run()
        // Tags are part of a document's curated state — bump its sync clock.
        current.queries.touchMeta.run({
          id,
          meta_updated_at: Date.now(),
          last_writer: getSettings().deviceId
        })
      })
      tx()
      return current.queries.getTagsForDocument.all(id) as Tag[]
    }
  )

  ipcMain.handle('db:status', (): DbStatus => {
    const current = getDb()
    if (!current) {
      return { open: false, rootPath: null, dbPath: null, schemaVersion: null, documentCount: null }
    }
    const schemaVersion = current.db.pragma('user_version', { simple: true }) as number
    const documentCount = current.queries.countDocuments.get()?.n ?? 0
    return {
      open: true,
      rootPath: current.rootPath,
      dbPath: current.dbPath,
      schemaVersion,
      documentCount
    }
  })

  // --- Phase 2: LAN sync ---

  // Push status changes (peer connect/disconnect, errors) to every window.
  onSyncChange(() => {
    const status = syncStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('sync:changed', status)
    }
  })

  ipcMain.handle('sync:host', async (): Promise<HostResult> => {
    try {
      const { code } = await startHosting()
      return { ok: true, code, error: null }
    } catch (err) {
      return { ok: false, code: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('sync:join', async (_evt, code: string): Promise<JoinResult> => {
    try {
      await joinSession(code)
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('sync:stop', async (): Promise<void> => {
    await stopSync()
  })

  ipcMain.handle('sync:status', (): SyncStatus => syncStatus())

  ipcMain.handle('sync:setDeviceName', async (_evt, name: string): Promise<AppSettings> => {
    const trimmed = name.trim()
    return updateSettings({ deviceName: trimmed || getSettings().deviceName })
  })
}

/**
 * Turn user input into a safe FTS5 MATCH expression. Each whitespace-
 * delimited token becomes a quoted phrase (AND-combined). Empty input
 * yields null so callers can short-circuit.
 */
function normalizeEmpty(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null
  const t = v.trim()
  return t === '' ? null : t
}

function safeParseFields(json: string): UserEditableField[] {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    const allowed: UserEditableField[] = ['title', 'doc_date', 'source', 'notes']
    return arr.filter((v): v is UserEditableField =>
      typeof v === 'string' && (allowed as string[]).includes(v)
    )
  } catch {
    return []
  }
}

/**
 * Filtered search builder. Combines FTS5 MATCH (when there's a query) with
 * a WHERE clause built from filters. When there's no query AND no FTS-required
 * filter, falls back to a plain documents scan so empty queries can still
 * filter by date/type/tags.
 */
function runFilteredSearch(
  db: import('better-sqlite3').Database,
  rawQuery: string,
  filters: SearchFilters,
  options: SearchOptions
): SearchResult[] {
  const fts = toFtsMatchExpression(rawQuery)
  const where: string[] = []
  const params: Record<string, unknown> = {}
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const offset = Math.max(options.offset ?? 0, 0)
  params.limit = limit
  params.offset = offset

  if (filters.dateFrom) {
    where.push(`d.doc_date >= @dateFrom`)
    params.dateFrom = filters.dateFrom
  }
  if (filters.dateTo) {
    where.push(`d.doc_date <= @dateTo`)
    params.dateTo = filters.dateTo
  }
  if (filters.exts && filters.exts.length > 0) {
    const placeholders = filters.exts.map((_, i) => `@ext${i}`).join(',')
    where.push(`d.ext IN (${placeholders})`)
    filters.exts.forEach((e, i) => {
      params[`ext${i}`] = e.toLowerCase()
    })
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    const placeholders = filters.tagIds.map((_, i) => `@tag${i}`).join(',')
    // anyTag = match docs having ANY selected tag; default = match ALL.
    const having = filters.anyTag
      ? ''
      : `HAVING COUNT(DISTINCT tag_id) = ${filters.tagIds.length}`
    where.push(`d.id IN (
      SELECT document_id FROM document_tags
       WHERE tag_id IN (${placeholders})
       GROUP BY document_id
       ${having}
    )`)
    filters.tagIds.forEach((id, i) => {
      params[`tag${i}`] = id
    })
  }
  if (filters.folderRel) {
    where.push(`d.rel_path LIKE @folderPrefix || '%'`)
    params.folderPrefix = filters.folderRel.replace(/\/?$/, '/')
  }

  let sql: string
  if (fts) {
    where.unshift(`documents_fts MATCH @fts`)
    params.fts = fts
    // Match boundaries use sentinel control chars (char(1)/char(2)); the
    // renderer-safe HTML is produced by renderSnippet below.
    sql = `
      SELECT d.id, d.rel_path, d.filename, d.title, d.doc_date,
             d.extraction_status, d.error_message,
             snippet(documents_fts, 4, char(1), char(2), '…', 16) AS snippet
        FROM documents_fts
        JOIN documents d ON d.id = documents_fts.rowid
       WHERE ${where.join(' AND ')}
       ORDER BY rank
       LIMIT @limit OFFSET @offset
    `
  } else {
    sql = `
      SELECT d.id, d.rel_path, d.filename, d.title, d.doc_date,
             d.extraction_status, d.error_message,
             '' AS snippet
        FROM documents d
       ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY COALESCE(d.doc_date, '9999-99-99') DESC, d.filename
       LIMIT @limit OFFSET @offset
    `
  }

  let rows: SearchResult[]
  try {
    rows = db.prepare(sql).all(params) as SearchResult[]
  } catch (err) {
    // FTS5 can still reject some MATCH inputs; degrade to empty results
    // instead of throwing an unhandled rejection across the IPC bridge (WR-09).
    console.error('search query failed:', err)
    return []
  }
  return rows.map((r) => ({ ...r, snippet: renderSnippet(r.snippet) }))
}
