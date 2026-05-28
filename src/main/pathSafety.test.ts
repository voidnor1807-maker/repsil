import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { resolveInsideArchive } from './pathSafety'

const ROOT = isAbsolute('/archive') ? '/archive' : 'C:\\archive'

describe('resolveInsideArchive', () => {
  it('accepts a normal relative file path', () => {
    expect(resolveInsideArchive(ROOT, 'docs/report.pdf')).not.toBeNull()
  })

  it('accepts nested paths and keeps them inside the root', () => {
    const abs = resolveInsideArchive(ROOT, 'a/b/c.png')
    expect(abs).toContain('a')
    expect(abs).toContain('c.png')
  })

  it('rejects forward-slash parent traversal', () => {
    expect(resolveInsideArchive(ROOT, '../secrets/key.txt')).toBeNull()
    expect(resolveInsideArchive(ROOT, 'a/../../etc/passwd')).toBeNull()
  })

  it('rejects backslash parent traversal (Windows)', () => {
    expect(resolveInsideArchive(ROOT, '..\\..\\windows\\system32\\drivers\\etc\\hosts')).toBeNull()
  })

  it('rejects Windows drive-letter absolute paths', () => {
    expect(resolveInsideArchive(ROOT, 'C:\\evil.exe')).toBeNull()
    expect(resolveInsideArchive(ROOT, 'd:/evil')).toBeNull()
  })

  it('rejects null-byte injection', () => {
    expect(resolveInsideArchive(ROOT, 'ok.pdf\0.png')).toBeNull()
  })

  it('rejects empty / non-string input', () => {
    expect(resolveInsideArchive(ROOT, '')).toBeNull()
    expect(resolveInsideArchive(ROOT, '/')).toBeNull()
    expect(resolveInsideArchive(ROOT, undefined)).toBeNull()
    expect(resolveInsideArchive(ROOT, 123)).toBeNull()
  })

  it('strips leading slashes and treats the remainder as relative', () => {
    expect(resolveInsideArchive(ROOT, '/docs/a.pdf')).not.toBeNull()
  })

  it('rejects a path that resolves to the root itself', () => {
    expect(resolveInsideArchive(ROOT, '.')).toBeNull()
  })
})
