import { describe, expect, it } from 'vitest'
import { evaluateArchiveMatch } from './guard'

describe('evaluateArchiveMatch', () => {
  it('syncs when ids match', () => {
    expect(evaluateArchiveMatch({ id: 'a', empty: false }, { id: 'a', empty: false })).toBe('sync')
    expect(evaluateArchiveMatch({ id: 'a', empty: true }, { id: 'a', empty: false })).toBe('sync')
  })

  it('lets a pristine local archive adopt an established remote', () => {
    expect(evaluateArchiveMatch({ id: 'x', empty: true }, { id: 'y', empty: false })).toBe(
      'adopt-remote'
    )
  })

  it('keeps local id when the remote is the pristine one', () => {
    expect(evaluateArchiveMatch({ id: 'x', empty: false }, { id: 'y', empty: true })).toBe(
      'remote-adopts'
    )
  })

  it('refuses two established archives with different ids', () => {
    expect(evaluateArchiveMatch({ id: 'x', empty: false }, { id: 'y', empty: false })).toBe('refuse')
  })

  it('is mirror-consistent: both sides reach compatible verdicts', () => {
    const a = { id: 'aaa', empty: true }
    const b = { id: 'bbb', empty: true }
    const va = evaluateArchiveMatch(a, b)
    const vb = evaluateArchiveMatch(b, a)
    // exactly one side adopts, the other keeps
    expect(new Set([va, vb])).toEqual(new Set(['adopt-remote', 'remote-adopts']))
  })
})
