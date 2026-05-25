import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ar from './ar.json'
import type { Language } from '@shared/types'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false
})

/**
 * Switches both i18next language AND <html> dir/lang attributes.
 * Always use this — never call i18n.changeLanguage directly — so the
 * document direction stays in sync with the UI language.
 */
export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

export default i18n
