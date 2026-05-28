import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations } from './migrate'
import { createQueries, type Queries } from './queries'

export interface RepsilDb {
  db: BetterSqlite3.Database
  queries: Queries
  rootPath: string
  dbPath: string
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

  current = { db, queries: createQueries(db), rootPath, dbPath }
  return current
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
