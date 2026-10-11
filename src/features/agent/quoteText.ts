/**
 * Selected text → a Markdown blockquote for the Agent composer (引用到 Agent with a selection). Pure — tested in
 * quoteText.test.ts.
 */

/** A quote longer than this is cut (with …): the composer is for asking, not for pasting documents. */
export const QUOTE_MAX_CHARS = 4000

export function quoteBlock(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim()
  if (!normalized) return undefined
  const cut = normalized.length > QUOTE_MAX_CHARS ? `${normalized.slice(0, QUOTE_MAX_CHARS).trimEnd()}…` : normalized
  return cut
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
}
