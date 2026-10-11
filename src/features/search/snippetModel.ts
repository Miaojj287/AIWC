/**
 * Snippets of 搜索聊天记录 hits: the substrate's match markers turned into plain / matched text parts, and the text
 * 复制文字 copies. No React — tested in snippetModel.test.ts.
 */
import type { SearchHit } from '@aiwc/protocol'

/** Characters as people count them: one per CJK character or emoji. */
export const charCount = (s: string): number => [...s].length

export interface SnippetPart {
  text: string
  mark: boolean
}

const HAN_RUN = /\p{Script=Han}+|[^\p{Script=Han}]+/gu
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * The pieces of a query the substrate matches separately (packages/substrate/src/mirror/search.ts
 * `buildFtsQueries`): whitespace-separated tokens split into Han / non-Han runs, edge punctuation dropped,
 * lower-cased.
 */
export function matchTerms(query: string): string[] {
  const terms = new Set<string>()
  for (const token of query.trim().split(/\s+/)) {
    for (const run of token.match(HAN_RUN) ?? []) {
      const term = run.replace(EDGE_PUNCTUATION, '').toLowerCase()
      if (term) terms.add(term)
    }
  }
  return [...terms]
}

function wrapsTerm(inner: string, terms: readonly string[]): boolean {
  const text = inner.trim().toLowerCase()
  if (!text) return false
  return terms.some((term) => text.includes(term) || term.includes(text))
}

/** Mark term occurrences the substrate left unmarked. A lone Latin letter is not marked: it would light up every word. */
function markTerms(text: string, terms: readonly string[]): SnippetPart[] {
  const usable = terms.filter((term) => charCount(term) >= 2 || CJK.test(term))
  if (usable.length === 0) return [{ text, mark: false }]
  const parts: SnippetPart[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    let length = 0
    for (const term of usable) {
      if (term.length > length && text.slice(i, i + term.length).toLowerCase() === term) length = term.length
    }
    if (length === 0) {
      i += 1
      continue
    }
    if (i > start) parts.push({ text: text.slice(start, i), mark: false })
    parts.push({ text: text.slice(i, i + length), mark: true })
    i += length
    start = i
  }
  if (start < text.length) parts.push({ text: text.slice(start), mark: false })
  return parts
}

function mergeParts(parts: readonly SnippetPart[]): SnippetPart[] {
  const out: SnippetPart[] = []
  for (const part of parts) {
    if (!part.text) continue
    const last = out[out.length - 1]
    if (last && last.mark === part.mark) last.text += part.text
    else out.push({ ...part })
  }
  return out
}

/**
 * Split a substrate snippet into plain and matched text. The substrate wraps matches in `[` `]` (FTS5 `snippet()`
 * and its LIKE lane), but message text has brackets of its own — WeChat emoji are `[微笑]` — so a pair counts as a
 * marker only when what it wraps matches a query term; other brackets stay text. Occurrences the substrate left
 * unmarked (the LIKE lane marks the first one, an excerpt fallback none) are marked too. Never HTML: callers render
 * the parts as text.
 */
export function parseSnippet(snippet: string, query: string): SnippetPart[] {
  const terms = matchTerms(query)
  const text = snippet.replace(/\s+/g, ' ')
  const parts: SnippetPart[] = []
  let plain = ''
  const flush = () => {
    if (plain) parts.push(...markTerms(plain, terms))
    plain = ''
  }
  let i = 0
  while (i < text.length) {
    const close = text.indexOf(']', i)
    if (close < 0) break
    const open = text.lastIndexOf('[', close)
    const inner = open >= i ? text.slice(open + 1, close) : ''
    if (open >= i && wrapsTerm(inner, terms)) {
      plain += text.slice(i, open)
      flush()
      parts.push({ text: inner, mark: true })
    } else {
      plain += text.slice(i, close + 1)
    }
    i = close + 1
  }
  plain += text.slice(i)
  flush()
  return mergeParts(parts)
}

/** What 复制文字 copies: the message text, else the snippet without its markers. */
export function copyTextOf(hit: SearchHit, query: string): string {
  const text = hit.message.text.trim()
  if (text) return text
  return parseSnippet(hit.snippet, query)
    .map((part) => part.text)
    .join('')
    .trim()
}
