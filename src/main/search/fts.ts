/**
 * Turn user input into a safe FTS5 MATCH expression. Each whitespace-
 * delimited token becomes a quoted *prefix* phrase (AND-combined). The
 * trailing `*` lets the user find a doc as they type ("gi" finds "gift.html"),
 * which is what people expect from a search box. Embedded double quotes are
 * stripped so a user can't inject FTS syntax. Empty input yields null so
 * callers can short-circuit.
 */
export function toFtsMatchExpression(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    // Keep only tokens with at least one letter or digit (any script). A token
    // of pure punctuation (e.g. "+", "(") tokenizes to nothing and makes FTS5
    // throw "fts5: syntax error" on the resulting empty phrase (WR-09).
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t}"*`).join(' ')
}
