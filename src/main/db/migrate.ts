import type Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((m) => m.version > current)
  if (pending.length === 0) return

  const target = pending[pending.length - 1].version
  if (!Number.isInteger(target)) throw new Error(`Invalid migration version: ${target}`)

  const apply = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql)
    }
    // Stamp the version once, as the final statement. If any migration above
    // throws, the whole transaction (DDL + version) rolls back together, so the
    // schema and user_version can never disagree (WR-02).
    db.pragma(`user_version = ${target}`)
  })
  apply()
}
