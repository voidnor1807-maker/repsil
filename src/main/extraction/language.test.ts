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
})
