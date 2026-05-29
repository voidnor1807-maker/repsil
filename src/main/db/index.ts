import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { runMigrations } from './migrate'
import { createQueries, type Queries } from './queries'

export interface RepsilDb {
  db: BetterSqlite3.Database
  queries: Queries
  rootPath: string
  dbPath: string
  /** Stable per-archive identity; sync only proceeds between matching ids. */
  archiveId: string
}

/**
 * Read the archive's identity, generating and persisting one on first open. The
 * id is archive-scoped (lives in app_settings, travels with the archive).
 */
function ensureArchiveId(queries: Queries): string {
  const existing = queries.getAppSetting.get('archive_id') as { value: string } | undefined
  if (existing?.value) return existing.value
  const id = randomUUID()
  queries.setAppSetting.run({ key: 'archive_id', value: id })
  return id
}

let current: RepsilDb | null = null

export function getDb(): RepsilDb | null {
  return current
}

export function openDb(rootPath: string): RepsilDb {
  if (current && current.rootPath === rootPath) return current
  if (current) closeDb()

  const repsilDir = join(rootPath, '.repsil')
  mkdirSync(repsilDir, { recursive: true })
  const dbPath = join(repsilDir, 'repsil.db')

  const db = new BetterSqlite3(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  runMigrations(db)

  const queries = createQueries(db)
  const archiveId = ensureArchiveId(queries)
  current = { db, queries, rootPath, dbPath, archiveId }
  return current
}

/**
 * Adopt a new archive identity (used when a pristine archive becomes a replica
 * of a peer during sync). Persists to app_settings and updates the live handle.
 */
export function setArchiveId(id: string): void {
  if (!current) return
  current.queries.setAppSetting.run({ key: 'archive_id', value: id })
  current.archiveId = id
}

export function closeDb(): void {
  if (!current) return
  const { db } = current
  try {
    // Fold the WAL back into the main db file so an archive switch doesn't
    // leave -wal/-shm files behind (IN-06).
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    console.error('Error closing DB:', err)
  } finally {
    current = null
  }
}
