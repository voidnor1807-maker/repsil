import { describe, expect, test } from 'vitest'
import { extOf, isIgnoredRel, toRel } from './paths'

describe('extOf', () => {
  test('lowercases extension without dot', () => {
    expect(extOf('Report.PDF')).toBe('pdf')
  })
  test('empty for no extension', () => {
    expect(extOf('README')).toBe('')
  })
  test('empty for dotfile with no real extension', () => {
    expect(extOf('.gitignore')).toBe('')
  })
  test('handles multiple dots', () => {
    expect(extOf('archive.tar.gz')).toBe('gz')
  })
})

describe('isIgnoredRel', () => {
  test('ignores .repsil dir and its contents', () => {
    expect(isIgnoredRel('.repsil')).toBe(true)
    expect(isIgnoredRel('.repsil/repsil.db')).toBe(true)
  })
  test('ignores OS noise files', () => {
    expect(isIgnoredRel('Thumbs.db')).toBe(true)
    expect(isIgnoredRel('sub/desktop.ini')).toBe(true)
    expect(isIgnoredRel('.DS_Store')).toBe(true)
  })
  test('allows normal files', () => {
    expect(isIgnoredRel('invoices/jan.pdf')).toBe(false)
  })
})

describe('toRel', () => {
  test('produces forward-slash relative path', () => {
    const root = process.platform === 'win32' ? 'C:\\arch' : '/arch'
    const abs = process.platform === 'win32' ? 'C:\\arch\\a\\b.pdf' : '/arch/a/b.pdf'
    expect(toRel(root, abs)).toBe('a/b.pdf')
  })
})
