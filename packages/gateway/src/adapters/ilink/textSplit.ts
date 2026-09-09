/**
 * Outbound text shaping for WeChat: explicit bubble separators and hard length chunking.
 */
import { ILINK_MAX_TEXT_LENGTH } from './protocol'

/**
 * The separator wherever it appears, not only alone on its own line.
 *
 * Models are told to put it on its own line and mostly do — but "mostly" is not good enough here:
 * an inline `…想吃什么？ ---wx-next--- 先垫垫…` used to survive the split and get pasted into WeChat
 * verbatim, so the contact received our internal marker. Matching it anywhere makes a stray marker
 * impossible to leak, and the surrounding whitespace is eaten so both halves stay clean.
 *
 * Leading dashes are allowed to vary (`--` … `-----`) because that is the one detail models get
 * wrong while still clearly meaning the separator.
 */
const SEPARATOR_RE = /[ \t]*-{2,}wx-next-{2,}[ \t]*/gi

/** Split on the '---wx-next---' marker into separate bubbles (trimmed, empties dropped). */
export function splitExplicitBubbles(text: string): string[] {
  return text
    .split(SEPARATOR_RE)
    .map((b) => b.trim())
    .filter(Boolean)
}

/**
 * Chunk one bubble to `maxLen` code points, preferring to break at a newline, then at sentence
 * punctuation, then at whitespace, and only as a last resort mid-word.
 */
export function chunkText(text: string, maxLen = ILINK_MAX_TEXT_LENGTH): string[] {
  const chars = Array.from(text)
  if (chars.length <= maxLen) return text ? [text] : []
  const out: string[] = []
  let start = 0
  while (start < chars.length) {
    const remaining = chars.length - start
    if (remaining <= maxLen) {
      out.push(chars.slice(start).join('').trim())
      break
    }
    const window = chars.slice(start, start + maxLen)
    let cut = -1
    const minCut = Math.floor(maxLen * 0.5)
    for (const pattern of [/\n/, /[。！？!?；;]/, /[，,、\s]/]) {
      for (let i = window.length - 1; i >= minCut; i--) {
        const ch = window[i]
        if (ch !== undefined && pattern.test(ch)) {
          cut = i + 1
          break
        }
      }
      if (cut > 0) break
    }
    if (cut <= 0) cut = maxLen
    out.push(window.slice(0, cut).join('').trim())
    start += cut
  }
  return out.filter(Boolean)
}

/** Full outbound shaping: explicit bubbles first, then each bubble chunked to the channel limit. */
export function shapeOutboundText(text: string, maxLen = ILINK_MAX_TEXT_LENGTH): string[] {
  return splitExplicitBubbles(text).flatMap((b) => chunkText(b, maxLen))
}
