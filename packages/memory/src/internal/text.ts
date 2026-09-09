/**
 * Text helpers: CJK detection, normalisation for duplicate checks, bigram tokenisation for the
 * zero-LLM keyword search, and bounded truncation.
 */

export function isCjkCode(c: number): boolean {
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unified
    (c >= 0x3400 && c <= 0x4dbf) || // ext A
    (c >= 0x3040 && c <= 0x30ff) || // hiragana / katakana
    (c >= 0xac00 && c <= 0xd7af) || // hangul
    (c >= 0xf900 && c <= 0xfaff) // compatibility ideographs
  )
}

export function hasCjk(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isCjkCode(text.charCodeAt(i))) return true
  return false
}

/** Canonical form used for duplicate detection: NFKC, lower-case, collapsed whitespace, no trailing punctuation. */
export function normaliseForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.。,，;；!！?？、~～·…\-—_]+$/u, '')
    .trim()
}

export function truncateChars(text: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max <= ellipsis.length) return text.slice(0, max)
  return text.slice(0, max - ellipsis.length) + ellipsis
}

const SEPARATOR = /[\s,.;:!?，。；：！？、"'“”‘’()（）\[\]【】<>《》/\\|~～·…\-—_+=*&^%$#@`]+/u

/**
 * Tokenise a query for keyword scoring. Latin words become lower-cased terms; CJK runs become
 * bigrams (and the whole run when it is short) so that "北京出差" matches "去北京" and "出差".
 */
export function tokenizeForSearch(query: string): string[] {
  const out = new Set<string>()
  for (const piece of query.normalize('NFKC').toLowerCase().split(SEPARATOR)) {
    if (!piece) continue
    let run = ''
    let latin = ''
    const flushRun = () => {
      if (!run) return
      if (run.length <= 3) out.add(run)
      if (run.length >= 2) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2))
      if (run.length === 1) out.add(run)
      run = ''
    }
    const flushLatin = () => {
      if (latin) out.add(latin)
      latin = ''
    }
    for (const ch of piece) {
      if (isCjkCode(ch.codePointAt(0) ?? 0)) {
        flushLatin()
        run += ch
      } else {
        flushRun()
        latin += ch
      }
    }
    flushRun()
    flushLatin()
  }
  return [...out]
}

export function countOccurrences(haystack: string, needle: string): { hits: number; first: number } {
  if (!needle) return { hits: 0, first: -1 }
  let hits = 0
  let first = -1
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) break
    if (first < 0) first = idx
    hits++
    from = idx + needle.length
  }
  return { hits, first }
}
