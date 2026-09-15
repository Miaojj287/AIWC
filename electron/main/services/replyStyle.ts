/**
 * Owner-voice extraction for auto-reply. The generator hands the model how THIS person writes in
 * THIS chat — verbatim samples plus a few measured habits — so the reply reads like them rather
 * than like an assistant, and then trims the assistant tics the model still adds (wrapping quotes,
 * Markdown, a full stop the owner never types).
 *
 * Pure functions, no I/O; tested in replyStyle.test.ts.
 */
import type { WxMessage } from '@aiwc/protocol'

export interface OwnerStyle {
  /** Verbatim recent messages by the owner in this chat: short, deduped, oldest first. */
  samples: string[]
  /** Owner text messages the habits were measured on (0 = nothing known, guide is empty). */
  measured: number
  medianChars: number
  /** Share of messages ending with 。！？!? */
  terminalPunctRatio: number
  /** Share of messages containing an emoji or a [表情]-style token. */
  emojiRatio: number
  /** Share of owner messages immediately followed by another owner message within BURST_GAP_MS. */
  burstRatio: number
  usesNin: boolean
}

export const EMPTY_STYLE: OwnerStyle = {
  samples: [],
  measured: 0,
  medianChars: 0,
  terminalPunctRatio: 0,
  emojiRatio: 0,
  burstRatio: 0,
  usesNin: false,
}

const MAX_SAMPLES = 24
const SAMPLE_MAX_CHARS = 80
const BURST_GAP_MS = 90_000
const BURST_MARKER = '---wx-next---'

const TERMINAL_PUNCT = /[。！？!?]$/u
const EMOJI = /\p{Extended_Pictographic}|\[[^\]\s]{1,8}\]/u
const LINK_OR_NUMBER = /https?:\/\/|^[\d\s.,:-]+$/iu

const usableSample = (text: string): boolean => {
  const t = text.trim()
  if (!t || t.length > SAMPLE_MAX_CHARS) return false
  if (LINK_OR_NUMBER.test(t)) return false
  return true
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

/** Measure the owner's habits in a window of this chat's messages (any order; sorted here). */
export function extractOwnerStyle(messages: readonly WxMessage[]): OwnerStyle {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt)
  const mine = ordered.filter((m) => m.isSelf && m.kind === 'text' && m.text.trim())
  if (mine.length === 0) return EMPTY_STYLE
  const texts = mine.map((m) => m.text.trim())
  const lengths = texts.map((t) => [...t].length)
  const terminal = texts.filter((t) => TERMINAL_PUNCT.test(t)).length
  const emoji = texts.filter((t) => EMOJI.test(t)).length
  let bursts = 0
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]!
    const b = ordered[i + 1]!
    if (a.isSelf && a.kind === 'text' && b.isSelf && b.createdAt - a.createdAt <= BURST_GAP_MS) bursts++
  }
  const seen = new Set<string>()
  const samples: string[] = []
  for (let i = texts.length - 1; i >= 0 && samples.length < MAX_SAMPLES; i--) {
    const t = texts[i]!
    if (!usableSample(t) || seen.has(t)) continue
    seen.add(t)
    samples.push(t)
  }
  samples.reverse()
  return {
    samples,
    measured: mine.length,
    medianChars: median(lengths),
    terminalPunctRatio: terminal / mine.length,
    emojiRatio: emoji / mine.length,
    burstRatio: bursts / mine.length,
    usesNin: texts.some((t) => t.includes('您')),
  }
}

/** The system-prompt section describing the owner's voice; empty string when nothing was measured. */
export function renderStyleGuide(style: OwnerStyle): string {
  if (style.measured === 0) return ''
  const habits: string[] = []
  habits.push(`一条消息通常 ${Math.max(1, style.medianChars)} 个字左右，回复长度照这个来，别写长`)
  habits.push(
    style.terminalPunctRatio < 0.2
      ? '句尾一般不加句号'
      : style.terminalPunctRatio > 0.6
        ? '句尾习惯加标点'
        : '句尾有时加标点有时不加',
  )
  habits.push(
    style.emojiRatio < 0.1
      ? '基本不用表情和 emoji'
      : style.emojiRatio > 0.4
        ? '常用表情 / emoji，可以照样用'
        : '偶尔用表情，别每条都用',
  )
  if (style.burstRatio >= 0.3) habits.push(`习惯连发几条短消息：需要时用单独一行 ${BURST_MARKER} 拆成两三条`)
  else habits.push('一般一条消息说完，不要拆成多条')
  if (!style.usesNin) habits.push('从不用「您」')
  const lines = ['## 主人在这个会话里的口吻', ...habits.map((h) => `- ${h}`)]
  if (style.samples.length > 0) {
    lines.push('', '主人最近发过的消息（逐条，原样）：')
    lines.push(...style.samples.map((s) => `- ${s}`))
  }
  return lines.join('\n')
}

const WRAPPING_QUOTES: Array<[string, string]> = [
  ['“', '”'],
  ['"', '"'],
  ['「', '」'],
  ['『', '』'],
  ["'", "'"],
]

function stripWrappingQuotes(text: string): string {
  let t = text.trim()
  for (let guard = 0; guard < 3; guard++) {
    const pair = WRAPPING_QUOTES.find(([open, close]) => t.length >= 2 && t.startsWith(open) && t.endsWith(close))
    if (!pair) break
    t = t.slice(pair[0].length, t.length - pair[1].length).trim()
  }
  return t
}

const REPLY_PREFIX = /^(回复|回复内容|回复正文|reply|答复|消息)\s*[:：]\s*/iu

/** Remove Markdown structure the model may add even when told not to. */
function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}(?:[-*+•]|\d+[.)])\s+/u, '').replace(/^\s{0,3}#{1,6}\s+/u, ''))
    .join('\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
}

/**
 * Trim assistant tics from a generated reply. Applied per bubble so a multi-bubble reply keeps its
 * split marker; the marker itself is normalised onto its own line.
 */
export function polishReply(raw: string, style: OwnerStyle = EMPTY_STYLE): string {
  const normalised = raw.replace(/\s*---wx-next---\s*/g, `\n${BURST_MARKER}\n`)
  const bubbles = normalised
    .split(BURST_MARKER)
    .map((part) => {
      let t = stripWrappingQuotes(stripMarkdown(part))
      t = stripWrappingQuotes(t.replace(REPLY_PREFIX, ''))
      t = t.replace(/\n{3,}/g, '\n\n').trim()
      if (style.measured > 0 && style.terminalPunctRatio < 0.2) t = t.replace(/。+$/u, '')
      return t
    })
    .filter(Boolean)
  return bubbles.join(`\n${BURST_MARKER}\n`)
}
