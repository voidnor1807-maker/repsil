import type { Theme } from '@shared/types'

/**
 * Toggles the .dark / .light class on <html>. NOTE: the current design
 * tokens are tuned for dark mode only — light mode is wired through the
 * infrastructure but the palette has not been designed yet. Phase 3 polish.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(theme)
}
