import { describe, expect, it } from 'vitest'
import { conflictSiblingRel } from './apply'

describe('conflictSiblingRel', () => {
  const now = new Date(2026, 4, 29, 9, 5, 3) // 2026-05-29 09:05:03

  it('inserts the conflict marker before the extension', () => {
    expect(conflictSiblingRel('docs/report.pdf', 'Laptop', now)).toBe(
      'docs/report.conflict-Laptop-20260529-090503.pdf'
    )
  })

  it('appends when there is no extension', () => {
    expect(conflictSiblingRel('notes', 'PC', now)).toBe('notes.conflict-PC-20260529-090503')
  })

  it('sanitizes the device name', () => {
    expect(conflictSiblingRel('a.txt', 'My PC/2', now)).toBe('a.conflict-My_PC_2-20260529-090503.txt')
  })

  it('does not mistake a dotted folder for an extension', () => {
    const out = conflictSiblingRel('a.b/file', 'X', now)
    expect(out).toBe('a.b/file.conflict-X-20260529-090503')
  })
})
