/**
 * Heuristic metadata auto-fill. Intentionally rough for v1.
 * The user_edited_fields guard lives upstream — this module just proposes.
 */

export interface MetadataGuess {
  doc_date: string | null  // ISO yyyy-mm-dd
  title: string | null
  source: string | null
}

export type DateFormat = 'dmy' | 'mdy'

export interface MetadataOptions {
  /** How to read ambiguous numeric dates like 03/04/2026. Default 'dmy'. */
  dateFormat?: DateFormat
}

const HEAD_CHARS = 2000

/** Normalize Arabic-Indic and Eastern Arabic-Indic digits to ASCII. */
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0)
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
    return String(code - 0x06F0)
  })
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
}

// Standard MSA Gregorian month names (Egyptian variant — most common in PDFs)
const AR_MONTHS: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6,
  'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10,
  'نوفمبر': 11, 'ديسمبر': 12
}

function isoFromYMD(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12) return null
  if (d < 1 || d > 31) return null
  if (y < 1900 || y > 2200) return null
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
}

function* candidateDates(text: string, dateFormat: DateFormat): Generator<string> {
  // Year-first (Iraqi/ISO style): 2026/5/27, 2026-05-27, 2026.5.27
  // Unambiguous because the 4-digit year leads.
  for (const m of text.matchAll(/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g)) {
    const iso = isoFromYMD(+m[1], +m[2], +m[3])
    if (iso) yield iso
  }
  // Two leading 1-2 digit groups then a year. Order of the first two groups
  // depends on the configured convention. Two-digit year assumed 2000s.
  for (const m of text.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    const month = dateFormat === 'mdy' ? +m[1] : +m[2]
    const day = dateFormat === 'mdy' ? +m[2] : +m[1]
    const iso = isoFromYMD(y, month, day)
    if (iso) yield iso
  }
  // English written month: "January 15, 2024" or "15 January 2024"
  const enNames = Object.keys(EN_MONTHS).join('|')
  const reEN1 = new RegExp(`\\b(${enNames})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi')
  for (const m of text.matchAll(reEN1)) {
    const mo = EN_MONTHS[m[1].toLowerCase()]
    const iso = isoFromYMD(+m[3], mo, +m[2])
    if (iso) yield iso
  }
  const reEN2 = new RegExp(`\\b(\\d{1,2})\\s+(${enNames})\\s+(\\d{4})\\b`, 'gi')
  for (const m of text.matchAll(reEN2)) {
    const mo = EN_MONTHS[m[2].toLowerCase()]
    const iso = isoFromYMD(+m[3], mo, +m[1])
    if (iso) yield iso
  }
  // Arabic written month: "15 يناير 2024"
  const arNames = Object.keys(AR_MONTHS).join('|')
  const reAR = new RegExp(`(\\d{1,2})\\s+(${arNames})\\s+(\\d{4})`, 'g')
  for (const m of text.matchAll(reAR)) {
    const mo = AR_MONTHS[m[2]]
    const iso = isoFromYMD(+m[3], mo, +m[1])
    if (iso) yield iso
  }
}

function guessDate(text: string, dateFormat: DateFormat): string | null {
  const head = normalizeDigits(text.slice(0, HEAD_CHARS))
  let earliest: string | null = null
  for (const iso of candidateDates(head, dateFormat)) {
    if (!earliest || iso < earliest) earliest = iso
  }
  return earliest
}

function guessTitle(text: string, fallbackFilename: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  for (const line of lines.slice(0, 8)) {
    if (line.length <= 100 && line.length >= 3) {
      // Looks like a heading if it doesn't end with a sentence punctuation
      if (!/[.!?،؛:]$/.test(line)) return line
    }
  }
  const dot = fallbackFilename.lastIndexOf('.')
  return dot > 0 ? fallbackFilename.slice(0, dot) : fallbackFilename
}

// Labels that identify the sender/source. Recipient labels ("To:", "إلى:")
// are intentionally excluded — they identify the wrong party for `source`.
// If a Recipient field is added to the schema later, scan for those there.
const SOURCE_LABELS_EN = ['From', 'Sender', 'Source', 'Issued by', 'Issuer']
const SOURCE_LABELS_AR = ['من', 'المرسل', 'المصدر', 'صادر عن', 'الصادر عن']

function cleanLabelValue(raw: string): string | null {
  // Strip surrounding whitespace, trailing punctuation, and quotes
  let v = raw.trim().replace(/[.,;،؛"'»«]+$/, '').trim()
  // Take only the first line if the value bled across newlines
  v = v.split(/\r?\n/)[0].trim()
  if (v.length < 2 || v.length > 80) return null
  return v
}

function scanForLabel(text: string, labels: string[]): string | null {
  // Build one regex matching `Label : value` at the start of any line.
  // Allow ':' (ASCII or fullwidth), '-', or '–' as separators.
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`^\\s*(?:${escaped})\\s*[:：\\-–]\\s*([^\\r\\n]+)`, 'gim')
  for (const m of text.matchAll(re)) {
    const v = cleanLabelValue(m[1])
    if (v) return v
  }
  return null
}

function guessSource(text: string): string | null {
  // 1. Whole-document scan for explicit From/Source/Sender labels (EN + AR)
  const labeled = scanForLabel(text, SOURCE_LABELS_EN) ?? scanForLabel(text, SOURCE_LABELS_AR)
  if (labeled) return labeled

  // 2. Fallback: rough "first proper-noun-looking line" in the header region
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 10)
  for (const line of lines) {
    if (line.length < 4 || line.length > 60) continue
    if (/^[A-Z][A-Za-z0-9 &.,'\-]+$/.test(line)) {
      const wordCount = line.split(/\s+/).length
      if (wordCount >= 1 && wordCount <= 6) return line
    }
    if (/^[؀-ۿݐ-ݿ\s]+$/.test(line) && line.length >= 4 && line.length <= 50) {
      return line
    }
  }
  return null
}

export function guessMetadata(
  text: string,
  filename: string,
  opts: MetadataOptions = {}
): MetadataGuess {
  return {
    doc_date: guessDate(text, opts.dateFormat ?? 'dmy'),
    title: guessTitle(text, filename),
    source: guessSource(text)
  }
}
