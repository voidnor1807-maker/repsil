import { beforeEach, describe, expect, test } from 'vitest'
import { clearAll, consumeMatch, consumeMatchBySize, recordDeletion } from './renameTracker'

const base = {
  content_hash: 'abc' as string | null,
  size_bytes: 100,
  filename: 'a.pdf',
  title: 'My Title' as string | null,
  doc_date: null,
  source: null,
  notes: null,
  user_edited_fields: '["title"]'
}

describe('renameTracker', () => {
  beforeEach(clearAll)

  test('matches by content hash and restores metadata', () => {
    recordDeletion({ ...base })
    expect(consumeMatch('abc')?.title).toBe('My Title')
  })

  test('hash match is one-shot', () => {
    recordDeletion({ ...base })
    consumeMatch('abc')
    expect(consumeMatch('abc')).toBeNull()
  })

  test('does not record when there is no metadata worth keeping', () => {
    recordDeletion({ ...base, title: null, user_edited_fields: '[]' })
    expect(consumeMatch('abc')).toBeNull()
  })

  test('falls back to size match when hash is null and size is unique', () => {
    recordDeletion({ ...base, content_hash: null })
    expect(consumeMatchBySize(100)?.title).toBe('My Title')
  })

  test('does NOT size-match when two same-size deletions are ambiguous', () => {
    recordDeletion({ ...base, content_hash: null, filename: 'a.pdf', title: 'A' })
    recordDeletion({ ...base, content_hash: null, filename: 'b.pdf', title: 'B' })
    expect(consumeMatchBySize(100)).toBeNull()
  })

  test('size match is one-shot', () => {
    recordDeletion({ ...base, content_hash: null })
    consumeMatchBySize(100)
    expect(consumeMatchBySize(100)).toBeNull()
  })
})
