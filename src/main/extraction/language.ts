import { franc } from 'franc-min'

export type DetectedLanguage = 'en' | 'ar' | null

/**
 * Two-stage detection: Unicode script first (decisive for Arabic vs Latin),
 * franc-min as fallback for further disambiguation.
 */
export function detectLanguage(text: string): DetectedLanguage {
  const trimmed = text.trim()
  if (trimmed.length < 8) return null

  const sample = trimmed.slice(0, 5000)
  let arabicChars = 0
  let latinChars = 0
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x0600 && code <= 0x06ff) || // Arabic
      (code >= 0x0750 && code <= 0x077f) || // Arabic Supplement
      (code >= 0xfb50 && code <= 0xfdff) || // Arabic Presentation Forms-A
      (code >= 0xfe70 && code <= 0xfeff)    // Arabic Presentation Forms-B
    ) {
      arabicChars++
    } else if ((code >= 0x0041 && code <= 0x007a) || (code >= 0x00c0 && code <= 0x024f)) {
      latinChars++
    }
  }

  const scriptTotal = arabicChars + latinChars
  if (scriptTotal > 0) {
    const arabicRatio = arabicChars / scriptTotal
    // Any meaningful Arabic presence wins — Arabic script is decisive and these
    // are exactly the bilingual EN/AR documents the app targets. The whole
    // [0.05, 0.3] band used to fall through unhandled (WR-07).
    if (arabicRatio >= 0.15) return 'ar'
    // Essentially all-Latin: it's English (franc on short Latin text is noisy).
    if (arabicRatio < 0.05) return 'en'
    // Genuinely ambiguous 0.05–0.15: let franc make a single call below.
  }

  const code = franc(sample, { minLength: 8 }) as string
  if (code === 'eng') return 'en'
  if (code === 'arb' || code === 'ara') return 'ar'
  // Mixed Latin-dominant text franc couldn't pin down: default to English.
  return scriptTotal > 0 && latinChars > 0 ? 'en' : null
}
