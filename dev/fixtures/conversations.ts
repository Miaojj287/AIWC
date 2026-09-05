/**
 * Builds individual conversations (bursts of messages) for the demo dataset. Pure functions over an
 * Rng; the caller assigns seq / ids after sorting.
 */
import type { MessageKind, WxMedia } from '@aiwc/protocol'
import type { Rng } from './prng.ts'
import {
  ACKS,
  DM_SCRIPTS,
  FILE_NAMES,
  GROUP_SCRIPTS,
  LINK_TITLES,
  QUESTIONS,
  STATEMENTS,
  type GroupTemplate,
} from './corpus.ts'

export interface Participant {
  id: string
  name: string
  isSelf: boolean
}

export interface DraftMessage {
  createdAt: number
  sender: Participant | null /** null = system */
  kind: MessageKind
  text: string
  media?: WxMedia
  quote?: { senderName?: string; text: string }
}

const DAY = 86_400_000
const MINUTE = 60_000

/** Hour-of-day weights (index = hour). */
const HOUR_WEIGHTS: Record<'general' | 'work' | 'evening', readonly number[]> = {
  general: [1, 0.4, 0.2, 0.1, 0.1, 0.2, 0.8, 2, 4, 6, 6.5, 6, 5, 5.5, 6, 6, 5.5, 5, 4.5, 5, 6, 6.5, 5, 3],
  work: [0.1, 0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 1, 3, 7, 8, 7, 4, 5, 8, 8, 7, 6, 5, 3, 1.5, 1, 0.5, 0.2],
  evening: [1.5, 0.5, 0.2, 0.1, 0.1, 0.1, 0.3, 0.8, 1.5, 2, 2.5, 2.5, 3, 2.5, 2, 2, 2.5, 3.5, 5, 6.5, 7, 7, 6, 3.5],
}

export interface TimeProfile {
  hours: keyof typeof HOUR_WEIGHTS
  /** probability that a burst lands on a weekend day */
  weekendBias: number
}

export function profileFor(flavor: GroupTemplate['flavor'] | 'dm'): TimeProfile {
  switch (flavor) {
    case 'work':
      return { hours: 'work', weekendBias: 0.08 }
    case 'social':
      return { hours: 'evening', weekendBias: 0.45 }
    case 'family':
      return { hours: 'general', weekendBias: 0.4 }
    default:
      return { hours: 'general', weekendBias: 0.28 }
  }
}

/**
 * Pick the start timestamp of a burst inside [now - days, now). Recent days are slightly favoured so
 * the session list looks alive.
 */
export function pickBurstStart(rng: Rng, now: number, days: number, profile: TimeProfile): number {
  for (let attempt = 0; attempt < 8; attempt++) {
    // bias towards recent days: square the uniform draw
    const u = rng.next()
    const dayOffset = Math.floor(u * u * days)
    const dayStart = startOfDay(now - dayOffset * DAY)
    const weekday = new Date(dayStart).getDay()
    const isWeekend = weekday === 0 || weekday === 6
    if (isWeekend && !rng.chance(profile.weekendBias * 2.5)) continue
    if (!isWeekend && rng.chance(profile.weekendBias * 0.4)) continue
    const hour = rng.weightedIndex(HOUR_WEIGHTS[profile.hours])
    const ts = dayStart + hour * 3_600_000 + rng.int(0, 59) * MINUTE + rng.int(0, 59_000)
    if (ts < now - MINUTE) return ts
  }
  return now - rng.int(2, 120) * MINUTE
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Gap between consecutive lines in a burst. */
function nextGap(rng: Rng): number {
  if (rng.chance(0.12)) return rng.int(8, 75) * MINUTE // someone went away
  if (rng.chance(0.3)) return rng.int(3, 20) * 1000
  return Math.round(rng.bell(15_000, 4 * MINUTE))
}

const NON_TEXT_KINDS: readonly MessageKind[] = ['image', 'voice', 'sticker', 'file', 'quote', 'link', 'revoke', 'video']
const NON_TEXT_WEIGHTS: readonly number[] = [4, 3.5, 3, 1.5, 2, 0.5, 0.3, 0.4]

/** Turn ~15% of plain lines into other message kinds. */
function decorate(rng: Rng, draft: DraftMessage, prev: DraftMessage | undefined): DraftMessage {
  if (!rng.chance(0.15)) return draft
  const kind = NON_TEXT_KINDS[rng.weightedIndex(NON_TEXT_WEIGHTS)] ?? 'text'
  switch (kind) {
    case 'image':
      return { ...draft, kind, text: '', media: { kind: 'image', sizeBytes: rng.int(80_000, 4_200_000) } }
    case 'video':
      return { ...draft, kind, text: '', media: { kind: 'video', durationMs: rng.int(4, 58) * 1000, sizeBytes: rng.int(1_500_000, 38_000_000) } }
    case 'voice': {
      const durationMs = rng.int(10, 450) * 100
      const media: WxMedia = { kind: 'voice', durationMs }
      if (rng.chance(0.55)) media.transcript = draft.text
      return { ...draft, kind, text: '', media }
    }
    case 'sticker':
      return { ...draft, kind, text: '', media: { kind: 'sticker', sizeBytes: rng.int(20_000, 300_000) } }
    case 'file': {
      const fileName = rng.pick(FILE_NAMES)
      return { ...draft, kind, text: '', media: { kind: 'file', fileName, sizeBytes: rng.int(12_000, 9_800_000) } }
    }
    case 'link':
      return { ...draft, kind, text: rng.pick(LINK_TITLES) }
    case 'quote': {
      if (!prev || prev.kind !== 'text' || !prev.sender || prev.sender.id === draft.sender?.id) return draft
      return { ...draft, kind, quote: { senderName: prev.sender.name, text: prev.text } }
    }
    case 'revoke': {
      const who = draft.sender?.isSelf ? '你' : draft.sender?.name ?? '对方'
      return { ...draft, kind, text: `${who}撤回了一条消息` }
    }
    default:
      return draft
  }
}

function fillerLines(rng: Rng): string[] {
  const n = rng.int(1, 4)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const pool = i === 0 ? (rng.chance(0.5) ? QUESTIONS : STATEMENTS) : rng.chance(0.55) ? ACKS : STATEMENTS
    out.push(rng.pick(pool))
  }
  return out
}

/** A 1:1 burst between `me` and `peer`. */
export function buildDmBurst(rng: Rng, me: Participant, peer: Participant, startAt: number, now: number): DraftMessage[] {
  const script = rng.chance(0.62) ? rng.pick(DM_SCRIPTS) : fillerLines(rng)
  const openerIsMe = rng.chance(0.5)
  const out: DraftMessage[] = []
  let ts = startAt
  for (let i = 0; i < script.length; i++) {
    const line = script[i] ?? ''
    const mine = i % 2 === 0 ? openerIsMe : !openerIsMe
    const draft: DraftMessage = { createdAt: ts, sender: mine ? me : peer, kind: 'text', text: line }
    out.push(decorate(rng, draft, out[out.length - 1]))
    ts += nextGap(rng)
    if (ts >= now) break
  }
  if (out.length > 0 && rng.chance(0.35) && ts < now) {
    const last = out[out.length - 1]
    const responder = last?.sender?.isSelf ? peer : me
    out.push({ createdAt: ts, sender: responder, kind: 'text', text: rng.pick(ACKS) })
  }
  return out
}

/**
 * A group burst. `speakers` are the members active in this session (3–8 people, may include me);
 * script roles are mapped onto them randomly.
 */
export function buildGroupBurst(
  rng: Rng,
  flavor: GroupTemplate['flavor'],
  speakers: Participant[],
  startAt: number,
  now: number,
): DraftMessage[] {
  const scripts = GROUP_SCRIPTS[flavor]
  const useScript = rng.chance(0.7)
  const roleMap = rng.shuffle(speakers)
  const out: DraftMessage[] = []
  let ts = startAt

  if (useScript) {
    const script = rng.pick(scripts)
    for (const line of script) {
      const sender = roleMap[line.speaker % roleMap.length] ?? roleMap[0]
      if (!sender) break
      const draft: DraftMessage = { createdAt: ts, sender, kind: 'text', text: line.text }
      out.push(decorate(rng, draft, out[out.length - 1]))
      ts += nextGap(rng)
      if (ts >= now) break
    }
  } else {
    for (const line of fillerLines(rng)) {
      const sender = rng.pick(roleMap)
      const draft: DraftMessage = { createdAt: ts, sender, kind: 'text', text: line }
      out.push(decorate(rng, draft, out[out.length - 1]))
      ts += nextGap(rng)
      if (ts >= now) break
    }
  }
  return out
}

/** Occasional system line for groups (join notices) or the "friend added" line for a dm. */
export function systemLine(rng: Rng, kind: 'group' | 'dm', names: string[], at: number): DraftMessage | undefined {
  if (kind === 'dm') {
    const peer = names[0]
    if (!peer) return undefined
    return { createdAt: at, sender: null, kind: 'system', text: `你已添加了${peer}，现在可以开始聊天了。` }
  }
  const [a, b] = rng.sample(names, 2)
  if (!a || !b) return undefined
  const text = rng.chance(0.6) ? `${a}邀请${b}加入了群聊` : `${b}通过扫描${a}分享的二维码加入群聊`
  return { createdAt: at, sender: null, kind: 'system', text }
}
