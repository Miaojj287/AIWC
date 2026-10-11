/**
 * Pure helpers for 每日待办: which items a (filtered) dashboard shows, open counts per scanned chat,
 * schedule / status wording, what a scan result says, and day labels. No React, no bridge.
 */
import {
  sortTodoItems,
  todoDateOf,
  type TodoConfig,
  type TodoItem,
  type TodoScanFailure,
  type TodoScanResult,
  type TodoSchedule,
  type TodoStatus,
} from '@aiwc/protocol'
import type { MessageKey, Translator } from '@/i18n'

const DAY_MS = 24 * 3_600_000

export interface VisibleItems {
  open: TodoItem[]
  done: TodoItem[]
}

/** Open (newest first) and checked (most recently checked first) items, optionally of one chat. */
export function visibleItems(items: readonly TodoItem[], sourceId?: string): VisibleItems {
  const sorted = sortTodoItems(sourceId ? items.filter((i) => i.sourceId === sourceId) : items)
  return { open: sorted.filter((i) => !i.done), done: sorted.filter((i) => i.done) }
}

/** Open items per scanned chat (user-typed items have no chat). */
export function openCountBySource(items: readonly TodoItem[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const i of items) if (!i.done && i.sourceId) out.set(i.sourceId, (out.get(i.sourceId) ?? 0) + 1)
  return out
}

/** 每 2 小时 / 每天 09:00 / 仅手动 */
export function describeTodoSchedule(schedule: TodoSchedule, t: Translator): string {
  switch (schedule.kind) {
    case 'hourly':
      return t('todo.schedule.hourly', { n: schedule.everyHours })
    case 'daily':
      return t('todo.schedule.daily', { time: schedule.time })
    case 'manual':
      return t('todo.schedule.manual')
  }
}

const FAILURE_KEY: Record<TodoScanFailure, MessageKey> = {
  disabled: 'todo.failure.disabled',
  no_sources: 'todo.failure.noSources',
  busy: 'todo.failure.busy',
  model_unavailable: 'todo.failure.modelUnavailable',
  substrate_unavailable: 'todo.failure.substrateUnavailable',
  cancelled: 'todo.failure.cancelled',
  failed: 'todo.failure.failed',
}

export const failureText = (failure: TodoScanFailure, t: Translator): string => t(FAILURE_KEY[failure])

export interface ScanOutcome {
  kind: 'success' | 'info' | 'warning' | 'error'
  text: string
  detail?: string
}

/** What a finished scan tells the user (toast after 立即扫描, the dashboard's last-scan hint). */
export function scanOutcome(result: TodoScanResult, t: Translator): ScanOutcome {
  const detail = result.detail ? { detail: result.detail } : {}
  if (!result.ok) {
    const failure = result.failure ?? 'failed'
    const kind = failure === 'cancelled' || failure === 'busy' ? 'info' : 'error'
    return { kind, text: failureText(failure, t), ...detail }
  }
  if (result.failed > 0)
    return { kind: 'warning', text: t('todo.outcome.partial', { n: result.failed, added: result.added }), ...detail }
  if (result.messages === 0) return { kind: 'info', text: t('todo.outcome.nothingNew') }
  if (result.added === 0) return { kind: 'success', text: t('todo.outcome.noTodos', { n: result.scanned }) }
  return { kind: 'success', text: t('todo.outcome.added', { n: result.added }) }
}

/** 今天 / 昨天 / 9月25日 */
export function dayLabel(date: string, t: Translator, now: number = Date.now()): string {
  if (date === todoDateOf(now)) return t('todo.day.today')
  if (date === todoDateOf(now - DAY_MS)) return t('todo.day.yesterday')
  const [, m, d] = date.split('-').map(Number)
  return t('todo.day.date', { month: m ?? 0, day: d ?? 0 })
}

/** Older / newer neighbour of `date` in the newest-first `days` list. */
export function adjacentDays(days: readonly string[], date: string | undefined): { older?: string; newer?: string } {
  const i = date ? days.indexOf(date) : -1
  if (i < 0) return {}
  return {
    ...(days[i + 1] ? { older: days[i + 1] } : {}),
    ...(i > 0 && days[i - 1] ? { newer: days[i - 1] } : {}),
  }
}

/** Summary card window: 09:00–14:30, or with the start date when it began on another day. */
export function summaryWindow(from: number, to: number, clock: (ms: number) => string, t: Translator): string {
  if (todoDateOf(from) === todoDateOf(to)) return t('todo.summary.window', { from: clock(from), to: clock(to) })
  const [, m, d] = todoDateOf(from).split('-').map(Number)
  return t('todo.summary.windowSince', { month: m ?? 0, day: d ?? 0, from: clock(from), to: clock(to) })
}

/**
 * The dashboard subtitle: schedule, then the last / next scan. On / off and the schedule come from the
 * live config (a switch flipped a moment ago shows at once); the scan times come from todo:status.
 */
export function statusLine(
  config: Pick<TodoConfig, 'enabled' | 'schedule'> | undefined,
  status: TodoStatus | undefined,
  t: Translator,
  time: (ms: number) => string,
): string {
  if (!config) return ''
  if (!config.enabled) return t('todo.status.off')
  if (status?.running) return t('todo.status.running')
  const parts = [describeTodoSchedule(config.schedule, t)]
  if (status?.last) parts.push(t('todo.status.last', { time: time(status.last.startedAt) }))
  else if (status) parts.push(t('todo.status.never'))
  if (status?.nextRunAt !== undefined && config.schedule.kind !== 'manual')
    parts.push(t('todo.status.next', { time: time(status.nextRunAt) }))
  return parts.join(' · ')
}

/** A scan time, past or future: 14:00 / 明天 09:00 / 昨天 22:00 / 9/25 09:00. */
export function scanTime(ms: number, t: Translator, clock: (ms: number) => string, now: number = Date.now()): string {
  const date = todoDateOf(ms)
  const time = clock(ms)
  if (date === todoDateOf(now)) return time
  if (date === todoDateOf(now + DAY_MS)) return t('todo.time.tomorrow', { time })
  if (date === todoDateOf(now - DAY_MS)) return t('todo.time.yesterday', { time })
  const [, m, d] = date.split('-').map(Number)
  return t('todo.time.date', { month: m ?? 0, day: d ?? 0, time })
}
