export type Language = 'en' | 'ar'

export interface AppSettings {
  language: Language
  rootPath: string | null
  firstRunComplete: boolean
}

export interface PickFolderResult {
  canceled: boolean
  path: string | null
}
