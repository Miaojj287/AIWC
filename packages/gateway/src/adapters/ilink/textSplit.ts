/**
 * Outbound text shaping for WeChat: explicit bubble separators and hard length chunking.
 */
import { splitOutboundBubbles } from '@aiwc/protocol'
import { ILINK_MAX_TEXT_LENGTH } from './protocol'

/**
 * Split on the '---wx-next---' marker (anywhere, not only on its own line) into separate bubbles, trimmed and
 * empties dropped. The rule lives in @aiwc/protocol so the Agent's send preview splits exactly as the senders do.
 */
export const splitExplicitBubbles: (text: string) => string[] = splitOutboundBubbles

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
