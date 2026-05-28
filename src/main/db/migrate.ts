import type Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((m) => m.version > current)
  if (pending.length === 0) return

  const apply = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    }
  })
  apply()
}
