import { describe, expect, test } from 'vitest'
import { toFtsMatchExpression } from './fts'

describe('toFtsMatchExpression', () => {
  test('quotes each whitespace-delimited token', () => {
    expect(toFtsMatchExpression('hello world')).toBe('"hello" "world"')
  })
  test('strips embedded double quotes to avoid syntax injection', () => {
    expect(toFtsMatchExpression('a"b c')).toBe('"ab" "c"')
  })
  test('returns null for empty input', () => {
    expect(toFtsMatchExpression('   ')).toBeNull()
  })
  test('preserves Arabic tokens', () => {
    expect(toFtsMatchExpression('فاتورة الكهرباء')).toBe('"فاتورة" "الكهرباء"')
  })
})
