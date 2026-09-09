/**
 * Clone corpus — pure data shaping (no model):
 *  - loadContactMessages(): page backwards through the substrate, ≤ MAX_MESSAGES
 *  - mergeTurns(): WeChat is not Q/A; consecutive messages by one speaker within TURN_GAP_MS form a turn
 *  - extractPairs(): other-turn → subject-turn within PAIR_MAX_GAP_MS, keeping the burst as separate
 *    messages and the turn before the prompt as `context` (callbacks are nonsense without it)
 *  - renderChunks(): chronological transcript split into ≤ PROFILE_CHUNK_CHARS blocks; when history
 *    is longer than PROFILE_MAX_CHUNKS the blocks are spread across the whole range, not just the tail
 *    (a person is not only who they were last month, and a quiet recent period would otherwise decide
 *    the whole profile) — the most recent RECENT_CHUNKS blocks are always kept.
 *  - pickSamples(): ≤ MAX_SAMPLES pairs spread across time, bursts preserved with BURST_JOINER
 */
import type { Millis, PersonaPair, PersonaSample, PersonaStats, SubstrateService, WxMessage } from '@aiwc/protocol'
import { truncateChars } from '../internal/text'

export const MIN_MESSAGES = 300
export const MAX_MESSAGES = 6000
export const TURN_GAP_MS = 3 * 60_000
export const PAIR_MAX_GAP_MS = 10 * 60_000
export const MSG_CHAR_CAP = 200
export const BURST_JOINER = '／'
export const PROFILE_CHUNK_CHARS = 8000
export const PROFILE_MAX_CHUNKS = 10
/** Of PROFILE_MAX_CHUNKS, how many always come from the tail of the history. */
export const RECENT_CHUNKS = 6
export const MAX_SAMPLES = 40
export const MAX_PAIRS = 2000
export const SAMPLE_TEXT_CAP = 160
export const SAMPLE_MAX_BURST = 6
const PAGE = 200

export interface CloneTurn {
  /** true when the profiled person (subject) spoke */
  subject: boolean
  texts: string[]
  start: Millis
  end: Millis
}

export type ClonePair = PersonaPair

export type CorpusStats = PersonaStats

/** Text usable for style analysis: text / quote / link caption, or a voice transcript. */
export function usableText(m: WxMessage): string | undefined {
  if (m.kind === 'text' || m.kind === 'quote') return m.text.trim() || undefined
  if (m.kind === 'voice') return m.media?.transcript?.trim() || undefined
  return undefined
}

export async function loadContactMessages(
  substrate: SubstrateService,
  contactId: string,
  opts: { max?: number; from?: Millis; to?: Millis; signal?: AbortSignal; onPage?: (loaded: number) => void } = {},
): Promise<WxMessage[]> {
  const max = opts.max ?? MAX_MESSAGES
  const out: WxMessage[] = []
  // "page backwards from this seq (exclusive)": start from +∞ so the first page is the most recent one
  let beforeSeq = Number.MAX_SAFE_INTEGER
  for (;;) {
    if (opts.signal?.aborted) throw new Error('aborted')
    const res = await substrate.listMessages({
      sessionId: contactId,
      beforeSeq,
      limit: Math.min(PAGE, max - out.length),
      ...(opts.from !== undefined ? { from: opts.from } : {}),
      ...(opts.to !== undefined ? { to: opts.to } : {}),
    })
    if (res.items.length === 0) break
    out.push(...res.items)
    opts.onPage?.(out.length)
    const minSeq = Math.min(...res.items.map((m) => m.seq))
    if (!res.hasMore || out.length >= max || minSeq >= beforeSeq) break
    beforeSeq = minSeq
  }
  const seen = new Set<string>()
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.seq - b.seq)
    .slice(-max)
}

export function mergeTurns(messages: readonly WxMessage[], subjectIsSelf: boolean): CloneTurn[] {
  const turns: CloneTurn[] = []
  for (const m of messages) {
    const text = usableText(m)
    if (!text) continue
    const subject = subjectIsSelf ? m.isSelf : !m.isSelf
    const capped = truncateChars(text, MSG_CHAR_CAP)
    const last = turns[turns.length - 1]
    if (last && last.subject === subject && m.createdAt - last.end <= TURN_GAP_MS) {
      last.texts.push(capped)
      last.end = m.createdAt
    } else {
      turns.push({ subject, texts: [capped], start: m.createdAt, end: m.createdAt })
    }
  }
  return turns
}

export function computeStats(messages: readonly WxMessage[], turns: readonly CloneTurn[], subjectIsSelf: boolean): CorpusStats {
  const isSubject = (m: WxMessage) => (subjectIsSelf ? m.isSelf : !m.isSelf)
  let voiceCount = 0
  let transcribedVoiceCount = 0
  // voiceRatio counts the subject's own conversational messages only: how much *they* like voice notes
  let subjectVoice = 0
  let subjectConversational = 0
  for (const m of messages) {
    if (m.kind === 'voice') {
      voiceCount++
      if (m.media?.transcript) transcribedVoiceCount++
    }
    if (!isSubject(m)) continue
    if (m.kind === 'text' || m.kind === 'quote') subjectConversational++
    else if (m.kind === 'voice') {
      subjectConversational++
      subjectVoice++
    }
  }
  let subjectMsgs = 0
  let subjectChars = 0
  let subjectTurns = 0
  for (const t of turns) {
    if (!t.subject) continue
    subjectTurns++
    subjectMsgs += t.texts.length
    for (const x of t.texts) subjectChars += x.length
  }
  return {
    messageCount: messages.length,
    subjectMessageCount: messages.filter(isSubject).length,
    voiceCount,
    transcribedVoiceCount,
    avgSubjectChars: subjectMsgs ? Math.round(subjectChars / subjectMsgs) : 0,
    avgSubjectBurst: subjectTurns ? Math.round((subjectMsgs / subjectTurns) * 10) / 10 : 0,
    voiceRatio: subjectConversational ? Math.round((subjectVoice / subjectConversational) * 1000) / 1000 : 0,
  }
}

/**
 * other-turn immediately followed by a subject-turn that starts within PAIR_MAX_GAP_MS.
 * The burst is kept message-by-message (the clone must learn to send three short lines, not one long
 * one) and the turn before the prompt travels along as `context`.
 */
export function extractPairs(turns: readonly CloneTurn[], max = MAX_PAIRS): ClonePair[] {
  const pairs: ClonePair[] = []
  for (let i = 1; i < turns.length; i++) {
    const ask = turns[i - 1]
    const reply = turns[i]
    if (!ask || !reply || ask.subject || !reply.subject) continue
    if (reply.start - ask.end > PAIR_MAX_GAP_MS) continue
    const prompt = truncateChars(ask.texts.join(BURST_JOINER), SAMPLE_TEXT_CAP)
    const replies = reply.texts.slice(0, SAMPLE_MAX_BURST).map((t) => truncateChars(t, SAMPLE_TEXT_CAP))
    if (prompt.length < 2 || replies.length === 0 || !replies.some((r) => r.length > 0)) continue
    const before = i >= 2 ? turns[i - 2] : undefined
    const context = before ? truncateChars(before.texts.join(BURST_JOINER), SAMPLE_TEXT_CAP) : undefined
    pairs.push({ at: reply.start, prompt, replies, ...(context ? { context } : {}) })
  }
  return pairs.slice(-max)
}

export function pairReplyText(pair: Pick<ClonePair, 'replies'>): string {
  return pair.replies.join(BURST_JOINER)
}

export function turnLine(turn: CloneTurn, subjectName: string, otherName: string): string {
  return `${turn.subject ? subjectName : otherName}: ${turn.texts.join(BURST_JOINER)}`
}

/**
 * Cut the transcript into blocks, then choose which blocks the model sees. Keeping only the tail
 * (the obvious choice) silently throws away years of a relationship and produces a profile of the
 * last few weeks; keeping the tail *and* evenly sampling the rest costs the same number of calls.
 */
export function renderChunks(turns: readonly CloneTurn[], subjectName: string, otherName: string, maxChunks = PROFILE_MAX_CHUNKS): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let chars = 0
  for (const t of turns) {
    const line = turnLine(t, subjectName, otherName)
    if (chars + line.length > PROFILE_CHUNK_CHARS && cur.length) {
      chunks.push(cur.join('\n'))
      cur = []
      chars = 0
    }
    cur.push(line)
    chars += line.length + 1
  }
  if (cur.length) chunks.push(cur.join('\n'))
  return selectChunks(chunks, maxChunks)
}

/** Tail-first selection: the last RECENT_CHUNKS blocks plus older ones spread evenly, chronological. */
export function selectChunks(chunks: readonly string[], maxChunks = PROFILE_MAX_CHUNKS): string[] {
  if (chunks.length <= maxChunks) return [...chunks]
  const recent = Math.min(RECENT_CHUNKS, maxChunks)
  const tailFrom = chunks.length - recent
  const older = chunks.slice(0, tailFrom)
  const slots = maxChunks - recent
  const picked: string[] = []
  if (slots > 0 && older.length > 0) {
    const step = older.length / slots
    let last = -1
    for (let i = 0; i < slots; i++) {
      const idx = Math.min(older.length - 1, Math.floor(i * step))
      if (idx === last) continue
      picked.push(older[idx] as string)
      last = idx
    }
  }
  return [...picked, ...chunks.slice(tailFrom)]
}

/** Spread ≤ max pairs across the whole time range, preferring replies with some substance. */
export function pickSamples(pairs: readonly ClonePair[], max = MAX_SAMPLES): PersonaSample[] {
  const substantive = pairs.filter((p) => pairReplyText(p).replace(/[\s\p{P}]/gu, '').length >= 2)
  const pool = substantive.length >= Math.min(max, 8) ? substantive : pairs
  const sorted = pool.slice().sort((a, b) => a.at - b.at)
  let chosen: ClonePair[]
  if (sorted.length <= max) chosen = sorted
  else {
    chosen = []
    const step = (sorted.length - 1) / (max - 1)
    let last = -1
    for (let i = 0; i < max; i++) {
      const idx = Math.min(sorted.length - 1, Math.round(i * step))
      if (idx === last) continue
      const p = sorted[idx]
      if (p) chosen.push(p)
      last = idx
    }
  }
  return chosen.map((p) => ({ prompt: p.prompt, reply: pairReplyText(p), at: p.at }))
}
