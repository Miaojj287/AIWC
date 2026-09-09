/**
 * Diary material selection — pure data shaping, no model calls.
 *  - diaryWindow(date, hour): [date-1 @ hour, date @ hour)
 *  - collectSessionMaterials(): the ≤16 sessions with the most messages in the window, ≤40 messages each
 *  - renderMaterial(): bounded "HH:mm 名字: text" lines the summariser reads
 */
import type { Millis, SubstrateService, WxMessage, WxSession } from '@aiwc/protocol'
import { mapConcurrent } from '../internal/model'
import { truncateChars } from '../internal/text'
import { atHour, formatClock, formatDate, shiftDate } from '../internal/time'

export interface DiaryWindow {
  start: Millis
  /** exclusive */
  end: Millis
}

export const DIARY_MAX_SESSIONS = 16
export const DIARY_MESSAGES_PER_SESSION = 40
export const DIARY_TEXT_CAP = 200
const COUNT_PROBE_LIMIT = 200
const SESSION_PAGE = 100
const MAX_SESSION_PAGES = 5
const MAX_CANDIDATES = 200

export function diaryWindow(date: string, hour: number): DiaryWindow {
  return { start: atHour(shiftDate(date, -1), hour), end: atHour(date, hour) }
}

/** The diary date whose window has most recently closed: today once `hour` has passed, else yesterday. */
export function targetDateFor(now: Millis, hour: number): string {
  const d = new Date(now)
  const today = formatDate(d)
  return d.getHours() >= hour ? today : shiftDate(today, -1)
}

export interface SessionMaterial {
  session: WxSession
  /** messages in the window, ≤ DIARY_MESSAGES_PER_SESSION, chronological */
  messages: WxMessage[]
  /** messages counted in the window (capped at the probe limit) */
  count: number
}

/** Model-facing text of one message; '' means skip (system / revoke). */
export function messageText(m: WxMessage): string {
  switch (m.kind) {
    case 'system':
    case 'revoke':
      return ''
    case 'voice':
      return m.media?.transcript ? `[语音] ${m.media.transcript}` : '[语音]'
    case 'image':
      return '[图片]'
    case 'video':
      return '[视频]'
    case 'file':
      return m.media?.fileName ? `[文件 ${m.media.fileName}]` : '[文件]'
    case 'sticker':
      return '[表情]'
    case 'location':
      return '[位置]'
    case 'transfer':
      return '[转账]'
    case 'card':
      return m.text ? `[名片] ${m.text}` : '[名片]'
    case 'link':
      return m.text ? `[链接] ${m.text}` : '[链接]'
    case 'quote':
      return m.quote ? `[回复「${truncateChars(m.quote.text, 30)}」] ${m.text}` : m.text
    default:
      return m.text || '[消息]'
  }
}

/** Evenly spaced sample that always keeps the first and last item. */
export function sampleEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice()
  if (max <= 1) return items.slice(0, 1)
  const out: T[] = []
  const step = (items.length - 1) / (max - 1)
  let last = -1
  for (let i = 0; i < max; i++) {
    const idx = Math.min(items.length - 1, Math.round(i * step))
    if (idx === last) continue
    const item = items[idx]
    if (item !== undefined) out.push(item)
    last = idx
  }
  return out
}

function inWindow(m: WxMessage, w: DiaryWindow): boolean {
  return m.createdAt >= w.start && m.createdAt < w.end
}

async function listCandidateSessions(substrate: SubstrateService, w: DiaryWindow, signal?: AbortSignal): Promise<WxSession[]> {
  const out: WxSession[] = []
  for (let page = 0; page < MAX_SESSION_PAGES; page++) {
    if (signal?.aborted) break
    const res = await substrate.listSessions({ kind: 'all', offset: page * SESSION_PAGE, limit: SESSION_PAGE })
    for (const s of res.items) {
      if (s.kind === 'system' || s.kind === 'official') continue
      if (s.lastMessageAt !== undefined && s.lastMessageAt < w.start) continue
      out.push(s)
    }
    if (!res.hasMore || res.items.length === 0) break
  }
  return out.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)).slice(0, MAX_CANDIDATES)
}

export async function collectSessionMaterials(
  substrate: SubstrateService,
  w: DiaryWindow,
  opts: { maxSessions?: number; perSession?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ materials: SessionMaterial[]; totalMessages: number }> {
  const maxSessions = opts.maxSessions ?? DIARY_MAX_SESSIONS
  const perSession = opts.perSession ?? DIARY_MESSAGES_PER_SESSION
  const candidates = await listCandidateSessions(substrate, w, opts.signal)
  const probed = await mapConcurrent(
    candidates,
    4,
    async (session) => {
      if (opts.signal?.aborted) return undefined
      const res = await substrate.listMessages({ sessionId: session.id, from: w.start, to: w.end - 1, limit: COUNT_PROBE_LIMIT })
      const msgs = res.items.filter((m) => inWindow(m, w) && messageText(m) !== '').sort((a, b) => a.seq - b.seq)
      if (msgs.length === 0) return undefined
      return { session, all: msgs, count: msgs.length + (res.hasMore ? 1 : 0) }
    },
    opts.onProgress,
  )
  const ranked = probed
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .sort((a, b) => b.count - a.count || (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))
  const totalMessages = ranked.reduce((n, p) => n + p.count, 0)
  const materials = ranked.slice(0, maxSessions).map((p) => ({ session: p.session, messages: sampleEvenly(p.all, perSession), count: p.count }))
  return { materials, totalMessages }
}

export function senderLabel(m: WxMessage, session: WxSession): string {
  if (m.isSelf) return '我'
  if (session.kind === 'dm') return session.title || m.senderName || m.senderId
  return m.senderName || m.senderId
}

/** Bounded transcript lines for one session. */
export function renderMaterial(mat: SessionMaterial, textCap = DIARY_TEXT_CAP): string {
  return mat.messages
    .map((m) => `${formatClock(m.createdAt)} ${senderLabel(m, mat.session)}: ${truncateChars(messageText(m).replace(/\s+/g, ' '), textCap)}`)
    .join('\n')
}

export function windowLabel(w: DiaryWindow): string {
  const f = (ms: Millis) => `${formatDate(ms)} ${formatClock(ms)}`
  return `${f(w.start)} 至 ${f(w.end)}`
}
