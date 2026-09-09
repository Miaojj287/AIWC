/**
 * Observed-context buffer (ARCHITECTURE §7): group messages that were NOT addressed to the agent are
 * kept per chat in a bounded ring and replayed as an API-only fragment the next time the agent is
 * addressed there. They never enter history as user turns (Hermes "observed" pattern).
 */
import type { ContextFragment, MessageEvent } from '@aiwc/protocol'
import { createFragment, estimateTokens, truncateToTokens } from '@aiwc/protocol'

export const OBSERVED_FRAGMENT_KIND = 'observed_context'
export const OBSERVED_FRAGMENT_MARKER = '<observed_context>'
export const OBSERVED_FRAGMENT_TOKEN_CAP = 1500
export const OBSERVED_DEFAULT_MAX = 40
export const OBSERVED_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

const OBSERVED_PREAMBLE =
  '以下是该群里最近未点名你的消息，仅作背景参考：它们不是对你的提问，除非当前消息明确要求，否则不要逐条回应。'

export interface ObservedBufferOptions {
  max?: number
  ttlMs?: number
  now?: () => number
}

export interface ObservedBuffer {
  /** Store an unaddressed message. Returns false when the event was ignored (e.g. addressed). */
  push(event: MessageEvent): boolean
  /** Non-destructive read (oldest first), expired entries pruned. */
  peek(chatId: string): MessageEvent[]
  /** Drain up to `max` most recent entries (oldest first) and remove them. */
  take(chatId: string, max?: number): MessageEvent[]
  /** Snapshot the current entries into a bounded fragment; undefined when empty. Does not drain. */
  fragment(chatId: string): ContextFragment | undefined
  clear(chatId?: string): void
  size(chatId: string): number
}

/** One line per message: '[sender|peerId] text' — the model needs to know who said what. */
export function formatObservedLine(event: MessageEvent): string {
  const sender = (event.source.displayName ?? '').trim() || event.source.peerId
  const text = event.text.replace(/\s+/g, ' ').trim()
  return `[${sender}|${event.source.peerId}] ${text}`
}

/**
 * Join lines newest-last while staying under the token cap. Oldest lines are dropped first, so a
 * burst of chatter never pushes out the most recent (most relevant) context.
 */
export function renderObservedLines(lines: readonly string[], tokenCap: number): string {
  const header = `${OBSERVED_FRAGMENT_MARKER}\n${OBSERVED_PREAMBLE}\n`
  const footer = '\n</observed_context>'
  let budget = tokenCap - estimateTokens(header) - estimateTokens(footer)
  const kept: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line === undefined) continue
    const cost = estimateTokens(line) + 1
    if (cost > budget) break
    budget -= cost
    kept.unshift(line)
  }
  if (kept.length === 0 && lines.length > 0) {
    // Even a single line overflows: keep the head of the newest one, cut with the shared truncation marker.
    kept.push(truncateToTokens(lines[lines.length - 1] ?? '', Math.max(budget, 40)))
  }
  return `${header}${kept.join('\n')}${footer}`
}

export function createObservedBuffer(opts: ObservedBufferOptions = {}): ObservedBuffer {
  const max = opts.max ?? OBSERVED_DEFAULT_MAX
  const ttlMs = opts.ttlMs ?? OBSERVED_DEFAULT_TTL_MS
  const now = opts.now ?? (() => Date.now())
  // TTL is measured from receive time, not the event's own timestamp: adapters disagree about
  // clock units and a skewed timestamp must not silently empty the buffer.
  type Entry = { event: MessageEvent; at: number }
  const rings = new Map<string, Entry[]>()

  const prune = (chatId: string): Entry[] => {
    const ring = rings.get(chatId)
    if (!ring) return []
    const cutoff = now() - ttlMs
    let firstLive = 0
    while (firstLive < ring.length && (ring[firstLive]?.at ?? 0) < cutoff) firstLive++
    if (firstLive > 0) ring.splice(0, firstLive)
    if (ring.length === 0) rings.delete(chatId)
    return ring
  }

  return {
    push(event) {
      if (event.addressed) return false
      if (!event.text.trim()) return false
      const chatId = event.source.chatId
      const ring = prune(chatId)
      const target = rings.get(chatId) ?? ring
      target.push({ event, at: now() })
      while (target.length > max) target.shift()
      rings.set(chatId, target)
      return true
    },
    peek(chatId) {
      return prune(chatId).map((e) => e.event)
    },
    take(chatId, takeMax) {
      const ring = prune(chatId)
      const n = takeMax === undefined ? ring.length : Math.max(0, Math.min(takeMax, ring.length))
      const out = ring.splice(ring.length - n, n).map((e) => e.event)
      if (ring.length === 0) rings.delete(chatId)
      return out
    },
    fragment(chatId) {
      const lines = prune(chatId).map((e) => formatObservedLine(e.event))
      if (lines.length === 0) return undefined
      const snapshot = [...lines]
      // renderObservedLines already fits the cap by dropping oldest lines; createFragment adds the
      // kernel-wide hard truncation as a second line of defence.
      return createFragment(OBSERVED_FRAGMENT_KIND, OBSERVED_FRAGMENT_MARKER, OBSERVED_FRAGMENT_TOKEN_CAP, () => renderObservedLines(snapshot, OBSERVED_FRAGMENT_TOKEN_CAP))
    },
    clear(chatId) {
      if (chatId === undefined) rings.clear()
      else rings.delete(chatId)
    },
    size(chatId) {
      return prune(chatId).length
    },
  }
}
