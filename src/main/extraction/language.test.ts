import { describe, expect, test } from 'vitest'
import { detectLanguage } from './language'

describe('detectLanguage', () => {
  test('detects English prose', () => {
    expect(detectLanguage('This is a normal English sentence about invoices.')).toBe('en')
  })
  test('detects Arabic prose', () => {
    expect(detectLanguage('هذه فاتورة كهرباء صادرة عن وزارة الكهرباء العراقية.')).toBe('ar')
  })
  test('returns null for too-short input', () => {
    expect(detectLanguage('hi')).toBeNull()
  })
  test('treats predominantly-Arabic mixed text as Arabic', () => {
    expect(detectLanguage('رقم invoice الفاتورة هو 12345 بتاريخ اليوم')).toBe('ar')
  })
  test('classifies a bilingual doc with ~20% Arabic as Arabic (WR-07 band)', () => {
    // Latin-heavy header with an Arabic stamp — previously fell through the
    // 0.05–0.3 gap and produced noisy franc output.
    const text =
      'Ministry of Electricity official invoice number 2026 issued today وزارة الكهرباء العراقية فاتورة'
    expect(detectLanguage(text)).toBe('ar')
  })
  test('classifies a mostly-English doc as English', () => {
    expect(
      detectLanguage('Dear customer, please find attached the monthly statement for your account.')
    ).toBe('en')
  })
})
