/**
 * Turn segments — how the transcript is grouped for display. Each user prompt (including a steer sent while the
 * agent is still working) opens a segment; everything the agent produced after it belongs to that segment until
 * the next prompt. A finished segment separates its answer from the work that led to it, so the work can fold
 * behind a 「已工作 1 分 20 秒」 header. The answer is everything from the first reply after the last tool call (or
 * after the last revision, when a check sent the agent back to rewrite its answer) to the end — a reply the agent
 * adds after its answer belongs to the answer, never to the folded work; a superseded draft belongs to the work. Running, stopped and failed segments never fold: the user must see what is happening and what
 * went wrong.
 */
import { dayDiff, formatClock } from '@/platform/format'
import { t } from '@/i18n'
import type { TurnId } from '@aiwc/protocol'
import type { ThreadItem } from './model'

type UserItem = Extract<ThreadItem, { kind: 'user' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant' }>

export type SegmentStatus = 'running' | 'done' | 'stopped' | 'failed'

export interface TurnSegment {
  key: string
  /** The turn the segment belongs to (the prompt's, or the first item's that carries one). */
  turnId?: TurnId
  /** The prompt that opened the segment; absent for items recorded without one. */
  user?: UserItem
  /** Everything after the prompt, in order. */
  body: ThreadItem[]
  status: SegmentStatus
  /**
   * Index in `body` where the answer starts (the first non-empty reply after the last tool call), once the segment
   * has finished with one. Everything from here to the end is the answer.
   */
  answerStart?: number
  /**
   * There is work before the answer (items, or the answer's own reasoning) that the header can fold. Only a segment
   * with a prompt has a header, so only such a segment ever folds.
   */
  foldable: boolean
  /** When the segment started (the prompt, or the live turn start). */
  startedAt?: number
  /** Latest recorded end among the segment's items; the live clock is used while running. */
  endedAt?: number
}

export type TimelineEntry = { kind: 'segment'; segment: TurnSegment } | { kind: 'standalone'; item: ThreadItem }

export interface TimelineOptions {
  streaming: boolean
  /** The running turn (its items may all still be empty placeholders). */
  activeTurnId?: TurnId
  /** Stands in for a prompt that has not been recorded yet. */
  turnStartedAt?: number
}

/** Anything earlier is not a real wall-clock time (fixtures, missing fields) and is ignored. */
const MIN_PLAUSIBLE_TIME_MS = Date.UTC(2000, 0, 1)

const hasText = (item: ThreadItem): item is AssistantItem => item.kind === 'assistant' && item.text.trim() !== ''

/** Latest end time an item recorded (assistant createdAt / start + duration, tool start + duration). */
function itemEnd(item: ThreadItem): number | undefined {
  switch (item.kind) {
    case 'assistant':
      return latest([
        item.createdAt,
        item.startedAt !== undefined ? item.startedAt + (item.durationMs ?? 0) : undefined,
      ])
    case 'tools':
      return latest(item.calls.map((c) => c.startedAt + (c.durationMs ?? 0)))
    case 'user':
      return item.createdAt
    case 'artifact':
    case 'plan':
    case 'compaction':
    case 'error':
    case 'aborted':
    case 'revision':
    case 'check':
      return undefined
  }
}

function latest(values: (number | undefined)[]): number | undefined {
  let out: number | undefined
  for (const v of values)
    if (v !== undefined && Number.isFinite(v) && v >= MIN_PLAUSIBLE_TIME_MS && (out === undefined || v > out)) out = v
  return out
}

const plausible = (ms: number | undefined): number | undefined =>
  ms !== undefined && Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_TIME_MS ? ms : undefined

function statusOf(body: ThreadItem[], running: boolean): SegmentStatus {
  if (running) return 'running'
  if (body.some((it) => it.kind === 'aborted')) return 'stopped'
  if (body.some((it) => it.kind === 'error')) return 'failed'
  return 'done'
}

interface OpenSegment {
  key: string
  turnId?: TurnId
  user?: UserItem
  body: ThreadItem[]
}

const turnOf = (item: ThreadItem): TurnId | undefined => ('turnId' in item ? item.turnId : undefined)

/**
 * Split visible items into segments: a prompt opens one, and so does an item of another turn arriving without a
 * prompt of its own. Compaction bars stand between segments (they describe the whole history, not one turn). While
 * streaming, the segment of the active turn is running; if none of its items is visible yet, a pending running
 * segment stands in for it.
 */
export function buildTimeline(items: ThreadItem[], options: TimelineOptions): TimelineEntry[] {
  const { streaming, activeTurnId, turnStartedAt } = options
  const segments: (OpenSegment | ThreadItem)[] = []
  let current: OpenSegment | undefined
  for (const item of items) {
    const turnId = turnOf(item)
    if (item.kind === 'compaction') {
      current = undefined
      segments.push(item)
    } else if (item.kind === 'user') {
      current = { key: item.id, turnId: item.turnId, user: item, body: [] }
      segments.push(current)
    } else {
      if (!current || (turnId !== undefined && current.turnId !== undefined && turnId !== current.turnId)) {
        current = { key: `lead_${item.id}`, turnId, body: [] }
        segments.push(current)
      }
      current.turnId ??= turnId
      current.body.push(item)
    }
  }
  const last = segments[segments.length - 1]
  const lastSegment = last && 'body' in last ? last : undefined
  const runningSegment =
    streaming && lastSegment && (activeTurnId === undefined || lastSegment.turnId === activeTurnId)
      ? lastSegment
      : undefined
  const entries: TimelineEntry[] = segments.map((entry) =>
    'body' in entry
      ? { kind: 'segment', segment: finish(entry, entry === runningSegment, turnStartedAt) }
      : { kind: 'standalone', item: entry },
  )
  if (streaming && !runningSegment) {
    // The turn started but nothing of it is visible yet: still show it as running.
    entries.push({
      kind: 'segment',
      segment: {
        key: `pending_${activeTurnId ?? ''}`,
        turnId: activeTurnId,
        body: [],
        status: 'running',
        foldable: false,
        startedAt: plausible(turnStartedAt),
      },
    })
  }
  return entries
}

function finish(seg: OpenSegment, running: boolean, turnStartedAt: number | undefined): TurnSegment {
  const status = statusOf(seg.body, running)
  const answerStart = status === 'running' ? undefined : findAnswerStart(seg.body)
  const answerHasReasoning =
    answerStart !== undefined &&
    seg.body.slice(answerStart).some((it) => it.kind === 'assistant' && Boolean(it.reasoning?.trim()))
  const foldable =
    Boolean(seg.user) && status === 'done' && answerStart !== undefined && (answerStart > 0 || answerHasReasoning)
  return {
    key: seg.key,
    turnId: seg.turnId,
    user: seg.user,
    body: seg.body,
    status,
    answerStart,
    foldable,
    startedAt: plausible(seg.user?.createdAt) ?? (running ? plausible(turnStartedAt) : undefined),
    endedAt: latest(seg.body.map(itemEnd)),
  }
}

/**
 * First non-empty reply after the last tool call or revision; none when the turn ended on tool calls with nothing
 * after them.
 */
function findAnswerStart(body: ThreadItem[]): number | undefined {
  let lastWork = -1
  body.forEach((it, i) => {
    if (it.kind === 'tools' || it.kind === 'revision') lastWork = i
  })
  for (let i = lastWork + 1; i < body.length; i++) {
    const it = body[i]
    if (it && hasText(it)) return i
  }
  return undefined
}

/** The replies that make up a finished segment's answer, in order. */
export function answerReplies(segment: TurnSegment): AssistantItem[] {
  if (segment.answerStart === undefined) return []
  return segment.body.slice(segment.answerStart).filter(hasText)
}

/** 12 秒 / 1 分 20 秒 / 8 分 / 1 小时 5 分 — at most two units, a zero second unit dropped. */
export function formatWorkDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? t('agent.turn.duration.hm', { h, m }) : t('agent.turn.duration.h', { h })
  if (m > 0) return s > 0 ? t('agent.turn.duration.ms', { m, s }) : t('agent.turn.duration.m', { m })
  return t('agent.turn.duration.s', { s })
}

/** HH:mm today, 昨天 HH:mm, M/D HH:mm this year, Y/M/D HH:mm before. */
export function messageTimeLabel(ms: number | undefined, now: number = Date.now()): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return ''
  const time = formatClock(ms)
  const days = dayDiff(ms, now)
  if (days <= 0) return time
  if (days === 1) return t('agent.message.yesterdayAt', { time })
  const d = new Date(ms)
  const date =
    d.getFullYear() === new Date(now).getFullYear()
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  return `${date} ${time}`
}
