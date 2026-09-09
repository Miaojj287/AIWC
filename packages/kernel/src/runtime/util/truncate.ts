export const TRUNCATION_MARKER = (n: number): string => `[…truncated ${n} chars]`

/** Cut `text` to at most `maxChars`, appending the standard marker. Returns the input untouched when short enough. */
export function truncateChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const removed = text.length - maxChars
  return { text: text.slice(0, maxChars) + '\n' + TRUNCATION_MARKER(removed), truncated: true }
}
