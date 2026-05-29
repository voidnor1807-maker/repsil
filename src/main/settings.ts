import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppSettings, DateFormat } from '@shared/types'
import { getDb } from './db'

const DEFAULTS: AppSettings = {
  language: 'en',
  theme: 'dark',
  dateFormat: 'dmy',
  pdfOcrMaxPages: 200,
  rootPath: null,
  firstRunComplete: false,
  deviceId: '',
  deviceName: ''
}

/**
 * Keys whose value belongs to the ARCHIVE (so it travels when the archive is
 * opened on another machine), not the machine. Stored in repsil.db's
 * app_settings table; everything else lives in userData/settings.json. (C2)
 */
const ARCHIVE_KEYS = ['dateFormat', 'pdfOcrMaxPages'] as const

let cached: AppSettings = { ...DEFAULTS }
let settingsPath = ''

function file(): string {
  if (!settingsPath) {
    settingsPath = join(app.getPath('userData'), 'settings.json')
  }
  return settingsPath
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(file(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    cached = { ...DEFAULTS, ...parsed }
  } catch {
    cached = { ...DEFAULTS }
  }
  // Generate a stable machine identity on first run and persist it.
  let mutated = false
  if (!cached.deviceId) {
    cached.deviceId = randomUUID()
    mutated = true
  }
  if (!cached.deviceName) {
    cached.deviceName = hostname() || 'Repsil device'
    mutated = true
  }
  if (mutated) {
    try {
      await fs.writeFile(file(), JSON.stringify(cached, null, 2), 'utf-8')
    } catch {
      // best-effort; identity will regenerate next run if this fails
    }
  }
  return cached
}

/**
 * Overlay archive-scoped settings from the open archive's DB onto the cache.
 * Call after openDb so the archive's own date convention / OCR cap win.
 */
export function loadArchiveSettings(): void {
  const repsil = getDb()
  if (!repsil) return
  const rows = repsil.queries.listAppSettings.all() as { key: string; value: string }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))

  const df = map.get('dateFormat')
  if (df === 'dmy' || df === 'mdy') cached.dateFormat = df as DateFormat

  const cap = map.get('pdfOcrMaxPages')
  if (cap !== undefined) {
    const n = Number(cap)
    if (Number.isFinite(n) && n > 0) cached.pdfOcrMaxPages = Math.floor(n)
  }
}

export function getSettings(): AppSettings {
  return cached
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  cached = { ...cached, ...patch }
  await fs.writeFile(file(), JSON.stringify(cached, null, 2), 'utf-8')

  // Persist archive-scoped keys into the open archive's DB so they travel.
  const repsil = getDb()
  if (repsil) {
    for (const key of ARCHIVE_KEYS) {
      if (key in patch) {
        repsil.queries.setAppSetting.run({ key, value: String(cached[key]) })
      }
    }
  }
  return cached
}
