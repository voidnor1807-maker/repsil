import { describe, expect, test } from 'vitest'
import { MATCH_END, MATCH_START, renderSnippet } from './snippet'

describe('renderSnippet', () => {
  test('wraps sentinel-delimited matches in <mark> tags', () => {
    const raw = `the ${MATCH_START}invoice${MATCH_END} total`
    expect(renderSnippet(raw)).toBe('the <mark>invoice</mark> total')
  })

  test('escapes HTML in document text so embedded markup cannot execute', () => {
    const raw = `before <img src=x onerror=alert(1)> after`
    expect(renderSnippet(raw)).toBe(
      'before &lt;img src=x onerror=alert(1)&gt; after'
    )
  })

  test('escapes ampersands and quotes', () => {
    expect(renderSnippet(`A & B "c" 'd'`)).toBe('A &amp; B &quot;c&quot; &#39;d&#39;')
  })

  test('escapes a literal <mark> typed inside the document, not just sentinels', () => {
    const raw = `text <mark>fake</mark> ${MATCH_START}real${MATCH_END}`
    expect(renderSnippet(raw)).toBe(
      'text &lt;mark&gt;fake&lt;/mark&gt; <mark>real</mark>'
    )
  })

  test('handles multiple matches', () => {
    const raw = `${MATCH_START}a${MATCH_END} and ${MATCH_START}b${MATCH_END}`
    expect(renderSnippet(raw)).toBe('<mark>a</mark> and <mark>b</mark>')
  })

  test('empty string stays empty', () => {
    expect(renderSnippet('')).toBe('')
  })
})
