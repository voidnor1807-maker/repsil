import { describe, expect, test } from 'vitest'
import { guessMetadata } from './metadata'

describe('guessMetadata — dates', () => {
  test('parses ISO date', () => {
    expect(guessMetadata('Dated 2026-05-27 here', 'f.pdf').doc_date).toBe('2026-05-27')
  })

  test('parses Iraqi year-first slash date', () => {
    expect(guessMetadata('التاريخ 2026/5/27', 'f.pdf').doc_date).toBe('2026-05-27')
  })

  test('day-first by default for ambiguous numeric date', () => {
    expect(guessMetadata('Date: 03/04/2026', 'f.pdf').doc_date).toBe('2026-04-03')
  })

  test('month-first when dateFormat=mdy', () => {
    expect(
      guessMetadata('Date: 03/04/2026', 'f.pdf', { dateFormat: 'mdy' }).doc_date
    ).toBe('2026-03-04')
  })

  test('normalizes Arabic-Indic digits', () => {
    expect(guessMetadata('بتاريخ ٢٠٢٦/٥/٢٧', 'f.pdf').doc_date).toBe('2026-05-27')
  })

  test('parses English written month', () => {
    expect(guessMetadata('Issued January 15, 2024', 'f.pdf').doc_date).toBe('2024-01-15')
  })

  test('parses Arabic written month', () => {
    expect(guessMetadata('حرر في 15 يناير 2024', 'f.pdf').doc_date).toBe('2024-01-15')
  })

  test('picks the earliest plausible date', () => {
    expect(guessMetadata('see 2026-05-27 and 2020-01-01', 'f.pdf').doc_date).toBe('2020-01-01')
  })

  test('returns null when no date present', () => {
    expect(guessMetadata('no dates here at all', 'f.pdf').doc_date).toBeNull()
  })
})

describe('guessMetadata — source labels', () => {
  test('extracts English From label', () => {
    expect(guessMetadata('From: ACME Insurance\nDear sir', 'f.pdf').source).toBe(
      'ACME Insurance'
    )
  })

  test('extracts Source label anywhere in the document', () => {
    const text = 'line one\nline two\n\nSource: City Council Office\nmore'
    expect(guessMetadata(text, 'f.pdf').source).toBe('City Council Office')
  })

  test('extracts Arabic sender label', () => {
    expect(guessMetadata('من: وزارة الصحة', 'f.pdf').source).toBe('وزارة الصحة')
  })

  test('does NOT use a To: recipient label as the source', () => {
    const text = 'To: John Smith\nbody text with no sender label'
    expect(guessMetadata(text, 'f.pdf').source).not.toBe('John Smith')
  })
})

describe('guessMetadata — title', () => {
  test('falls back to filename without extension when no heading', () => {
    expect(guessMetadata('', 'my-invoice.pdf').title).toBe('my-invoice')
  })
})
