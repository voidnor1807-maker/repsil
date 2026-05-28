import { beforeEach, describe, expect, test } from 'vitest'
import { clearAll, consumeMatch, consumeMatchBySize, recordDeletion } from './renameTracker'

const base = {
  content_hash: 'abc' as string | null,
  size_bytes: 100,
  ext: 'pdf',
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

  test('falls back to size+ext match when hash is null and the pair is unique', () => {
    recordDeletion({ ...base, content_hash: null })
    expect(consumeMatchBySize(100, 'pdf')?.title).toBe('My Title')
  })

  test('does NOT size-match when two same-size+ext deletions are ambiguous', () => {
    recordDeletion({ ...base, content_hash: null, filename: 'a.pdf', title: 'A' })
    recordDeletion({ ...base, content_hash: null, filename: 'b.pdf', title: 'B' })
    expect(consumeMatchBySize(100, 'pdf')).toBeNull()
  })

  test('does NOT size-match when the extension differs (WR-04)', () => {
    recordDeletion({ ...base, content_hash: null, ext: 'pdf' })
    expect(consumeMatchBySize(100, 'png')).toBeNull()
  })

  test('size+ext disambiguates two same-size files of different type', () => {
    recordDeletion({ ...base, content_hash: null, ext: 'pdf', title: 'The PDF' })
    recordDeletion({ ...base, content_hash: null, ext: 'png', filename: 'a.png', title: 'The PNG' })
    expect(consumeMatchBySize(100, 'png')?.title).toBe('The PNG')
  })

  test('size match is one-shot', () => {
    recordDeletion({ ...base, content_hash: null })
    consumeMatchBySize(100, 'pdf')
    expect(consumeMatchBySize(100, 'pdf')).toBeNull()
  })
})
