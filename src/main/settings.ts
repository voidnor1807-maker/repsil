import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'

const DEFAULTS: AppSettings = {
  language: 'en',
  rootPath: null,
  firstRunComplete: false
}

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
  return cached
}

export function getSettings(): AppSettings {
  return cached
}

export async function updateSettings(
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  cached = { ...cached, ...patch }
  await fs.writeFile(file(), JSON.stringify(cached, null, 2), 'utf-8')
  return cached
}
