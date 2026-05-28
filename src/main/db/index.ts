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
  current.db.close()
  current = null
}
