/**
 * 每日待办 material selection — pure data shaping, no model calls.
 *  - scanWindowStart(): where a chat's scan starts (after its cursor, never further back than MAX_LOOKBACK_MS)
 *  - collectSourceMessages(): the newest ≤ cap messages of one picked chat after its cursor
 *  - renderMessages(): bounded "[m3] HH:mm 名字: text" lines with neutralised tags (third-party text)
 */
import {
  todoDateOf,
  type Millis,
  type SubstrateService,
  type TodoSchedule,
  type WxMessage,
  type WxSession,
} from '@aiwc/protocol'
import { truncateChars } from '../internal/text'
import { formatClock } from '../internal/time'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** A chat never scanned before reads one schedule period back (a day for daily / manual). */
const FIRST_SCAN_FALLBACK_MS = DAY_MS
/** After a long pause (app closed for a week) only the last few days are read, not the whole backlog. */
export const MAX_LOOKBACK_MS = 3 * DAY_MS
/** One message line in the prompt. */
export const MESSAGE_TEXT_CAP = 240
/** Past the cursor with `beforeSeq`, so the real mirror and the fakes both return the newest page. */
const NEWEST_SEQ = Number.MAX_SAFE_INTEGER

/** Where the scan of one chat resumes: the last message it read. */
export interface SourceCursor {
  seq: number
  at: Millis
}

export interface SourceMaterial {
  session: Pick<WxSession, 'id' | 'title' | 'kind'>
  /** Readable messages after the cursor, chronological, ≤ cap. */
  messages: WxMessage[]
  /** More new messages existed than the cap; the oldest were skipped. */
  truncated: boolean
  /** Newest message seen (readable or not) — the cursor after a successful scan. */
  next?: SourceCursor
}

/** How far back a chat without a cursor is read: one schedule period. */
export function firstScanLookback(schedule: TodoSchedule): Millis {
  switch (schedule.kind) {
    case 'hourly':
      return schedule.everyHours * HOUR_MS
    case 'daily':
    case 'manual':
      return FIRST_SCAN_FALLBACK_MS
  }
}

export function scanWindowStart(cursor: SourceCursor | undefined, schedule: TodoSchedule, now: Millis): Millis {
  const floor = now - MAX_LOOKBACK_MS
  if (cursor) return Math.max(cursor.at, floor)
  return Math.max(now - firstScanLookback(schedule), floor)
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
    case 'text':
    case 'other':
      return m.text || '[消息]'
  }
}

export async function collectSourceMessages(
  substrate: SubstrateService,
  session: Pick<WxSession, 'id' | 'title' | 'kind'>,
  opts: { cursor?: SourceCursor; from: Millis; cap: number },
): Promise<SourceMaterial> {
  const res = await substrate.listMessages({
    sessionId: session.id,
    beforeSeq: NEWEST_SEQ,
    from: opts.from,
    limit: opts.cap,
  })
  const cursor = opts.cursor
  const fresh = res.items
    .filter((m) => m.createdAt >= opts.from && (!cursor || m.seq > cursor.seq))
    .sort((a, b) => a.seq - b.seq)
  const newest = fresh[fresh.length - 1]
  return {
    session,
    messages: fresh.filter((m) => messageText(m) !== ''),
    truncated: res.hasMore,
    ...(newest ? { next: { seq: newest.seq, at: newest.createdAt } } : {}),
  }
}

/** Third-party text goes into the prompt as data: no tag can open or close the prompt's own blocks. */
export const neutraliseTags = (s: string): string => s.replace(/</g, '＜').replace(/>/g, '＞')

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function senderLabel(m: WxMessage): string {
  if (m.isSelf) return '我'
  return m.senderName || m.senderId
}

/** Reference the model cites a todo by (m1, m2, …, in chronological order). */
export const messageRef = (index: number): string => `m${index + 1}`

/** Bounded transcript lines for one chat; line i carries messageRef(i). */
export function renderMessages(messages: readonly WxMessage[], textCap = MESSAGE_TEXT_CAP): string {
  return messages
    .map(
      (m, i) =>
        `[${messageRef(i)}] ${formatClock(m.createdAt)} ${neutraliseTags(oneLine(senderLabel(m)))}: ${neutraliseTags(
          truncateChars(oneLine(messageText(m)), textCap),
        )}`,
    )
    .join('\n')
}

/** "9-26 09:00 至 9-27 09:00" in the machine's local time (prompt wording, not UI copy). */
export function windowLabel(from: Millis, to: Millis): string {
  const f = (ms: Millis) => `${todoDateOf(ms)} ${formatClock(ms)}`
  return `${f(from)} 至 ${f(to)}`
}
