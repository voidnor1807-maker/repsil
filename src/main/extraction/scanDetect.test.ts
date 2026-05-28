import { describe, expect, test } from 'vitest'
import { classifyPdfPages } from './scanDetect'

describe('classifyPdfPages', () => {
  test('all pages have text -> digital, no OCR pages', () => {
    const r = classifyPdfPages([500, 480, 600])
    expect(r.kind).toBe('digital')
    expect(r.ocrPages).toEqual([])
  })

  test('all pages empty -> scanned, every page needs OCR', () => {
    const r = classifyPdfPages([0, 2, 1])
    expect(r.kind).toBe('scanned')
    expect(r.ocrPages).toEqual([0, 1, 2])
  })

  test('some empty pages -> partial, only empty pages need OCR', () => {
    const r = classifyPdfPages([500, 0, 600, 1])
    expect(r.kind).toBe('partial')
    expect(r.ocrPages).toEqual([1, 3])
  })

  test('empty document -> scanned with no pages', () => {
    const r = classifyPdfPages([])
    expect(r.kind).toBe('scanned')
    expect(r.ocrPages).toEqual([])
  })
})
