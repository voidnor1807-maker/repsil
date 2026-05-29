import { describe, expect, it } from 'vitest'
import { diffManifests, type Manifest } from './manifest'

const entry = (
  rel_path: string,
  content_hash: string,
  mtime: number,
  meta_updated_at: number | null = null
) => ({ rel_path, content_hash, size_bytes: 100, mtime, meta_updated_at })

const m = (entries: Manifest['entries'], tombstones: Manifest['tombstones'] = []): Manifest => ({
  entries,
  tombstones
})

describe('diffManifests', () => {
  it('pulls files the local side is missing', () => {
    const plan = diffManifests(m([]), m([entry('a.pdf', 'h1', 10)]))
    expect(plan.pullFiles).toEqual(['a.pdf'])
  })

  it('does not pull files only the local side has', () => {
    const plan = diffManifests(m([entry('a.pdf', 'h1', 10)]), m([]))
    expect(plan.pullFiles).toEqual([])
    expect(plan.pullMeta).toEqual([])
  })

  it('ignores identical files', () => {
    const local = m([entry('a.pdf', 'h1', 10, 5)])
    const remote = m([entry('a.pdf', 'h1', 10, 5)])
    const plan = diffManifests(local, remote)
    expect(plan.pullFiles).toEqual([])
    expect(plan.pullMeta).toEqual([])
  })

  it('pulls remote content when its mtime is newer, flagging a conflict', () => {
    const plan = diffManifests(m([entry('a.pdf', 'h1', 10)]), m([entry('a.pdf', 'h2', 20)]))
    expect(plan.pullFiles).toEqual(['a.pdf'])
    expect(plan.conflicts).toEqual(['a.pdf'])
  })

  it('keeps local content when local mtime is newer (no pull, no conflict here)', () => {
    const plan = diffManifests(m([entry('a.pdf', 'h1', 30)]), m([entry('a.pdf', 'h2', 20)]))
    expect(plan.pullFiles).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('breaks an mtime tie deterministically by content hash', () => {
    // equal mtime, remote hash greater → remote wins + conflict preserved
    const win = diffManifests(m([entry('a.pdf', 'h1', 10)]), m([entry('a.pdf', 'h2', 10)]))
    expect(win.conflicts).toEqual(['a.pdf'])
    // equal mtime, local hash greater → local wins, nothing pulled
    const keep = diffManifests(m([entry('a.pdf', 'h2', 10)]), m([entry('a.pdf', 'h1', 10)]))
    expect(keep.pullFiles).toEqual([])
    expect(keep.conflicts).toEqual([])
  })

  it('treats a missing local file as a plain pull, not a conflict', () => {
    const plan = diffManifests(m([]), m([entry('a.pdf', 'h1', 10)]))
    expect(plan.pullFiles).toEqual(['a.pdf'])
    expect(plan.conflicts).toEqual([])
  })

  it('pulls metadata only when content matches but remote meta is newer', () => {
    const plan = diffManifests(
      m([entry('a.pdf', 'h1', 10, 5)]),
      m([entry('a.pdf', 'h1', 10, 9)])
    )
    expect(plan.pullMeta).toEqual(['a.pdf'])
    expect(plan.pullFiles).toEqual([])
  })

  it('deletes locally when the remote tombstone is newer than the local file', () => {
    const plan = diffManifests(
      m([entry('a.pdf', 'h1', 10)]),
      m([], [{ rel_path: 'a.pdf', content_hash: 'h1', deleted_at: 20 }])
    )
    expect(plan.deleteLocal.map((d) => d.rel_path)).toEqual(['a.pdf'])
  })

  it('does not resurrect a file the local side re-created after the remote delete', () => {
    const plan = diffManifests(
      m([entry('a.pdf', 'h9', 30)]),
      m([], [{ rel_path: 'a.pdf', content_hash: 'h1', deleted_at: 20 }])
    )
    expect(plan.deleteLocal).toEqual([])
  })

  it('does not pull a file the local side deleted more recently', () => {
    const plan = diffManifests(
      m([], [{ rel_path: 'a.pdf', content_hash: 'h1', deleted_at: 30 }]),
      m([entry('a.pdf', 'h1', 20)])
    )
    expect(plan.pullFiles).toEqual([])
  })
})
