/**
 * FTS5 emits snippets with match boundaries marked by these sentinel control
 * characters (chosen because they cannot appear in real document text). We
 * HTML-escape the whole snippet first — so any markup in the document body is
 * neutralized — then swap the sentinels for real <mark> tags. This makes the
 * snippet safe to render via dangerouslySetInnerHTML.
 */
export const MATCH_START = String.fromCharCode(1)
export const MATCH_END = String.fromCharCode(2)

export function renderSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return escaped.split(MATCH_START).join('<mark>').split(MATCH_END).join('</mark>')
}
