/**
 * 定时任务 timing, pure: when a schedule fires next, which slots passed between two instants (missed while the app
 * was closed or the machine asleep), and the editor's preview. croner only parses and computes times here — firing
 * is taskTicker.ts's job, so a slot that passed during sleep is seen as missed instead of being fired late silently.
 */
import { Cron } from 'croner'
import type { TaskSchedule } from '@aiwc/protocol'

const PREVIEW_COUNT = 3
/** Missed slots counted one by one at most this many times (the count is informational). */
const MISSED_COUNT_CAP = 999

/** croner (6-field, seconds first) pattern for the calendar kinds; interval and once are timer-driven. */
export function cronPatternFor(schedule: TaskSchedule): string | undefined {
  switch (schedule.kind) {
    case 'daily': {
      const [h, m] = schedule.time.split(':').map(Number)
      return `0 ${m} ${h} * * *`
    }
    case 'weekly': {
      const [h, m] = schedule.time.split(':').map(Number)
      const days = [...new Set(schedule.days)].sort((a, b) => a - b).join(',')
      return `0 ${m} ${h} * * ${days}`
    }
    case 'cron':
      return schedule.expression
    case 'interval':
    case 'once':
      return undefined
  }
}

/** Next multiple of the interval after `now`, counted from `since`. */
export function nextIntervalAt(everyMinutes: number, since: number, now: number): number {
  const step = everyMinutes * 60_000
  if (now < since) return since
  const k = Math.floor((now - since) / step) + 1
  return since + k * step
}

/**
 * First fire time strictly after `after`; undefined when the schedule never fires again (a past one-shot, an
 * expression with no future match) or cannot be parsed.
 */
export function nextFireAt(schedule: TaskSchedule, since: number, after: number): number | undefined {
  switch (schedule.kind) {
    case 'interval':
      return nextIntervalAt(schedule.everyMinutes, since, after)
    case 'once':
      return schedule.at > after ? schedule.at : undefined
    case 'daily':
    case 'weekly':
    case 'cron': {
      const pattern = cronPatternFor(schedule)
      if (!pattern) return undefined
      try {
        const job = new Cron(pattern, { paused: true })
        const next = job.nextRun(new Date(after))?.getTime()
        job.stop()
        return next
      } catch {
        return undefined
      }
    }
  }
}

export interface MissedSlots {
  /** Slots in (from, to]. */
  count: number
  /** The latest of them; undefined when count is 0. */
  latest?: number
}

/** The slots a schedule had in (from, to] — the ones nobody ran when the app was closed or the machine asleep. */
export function missedSlots(schedule: TaskSchedule, since: number, from: number, to: number): MissedSlots {
  if (to <= from) return { count: 0 }
  if (schedule.kind === 'interval') {
    const step = schedule.everyMinutes * 60_000
    const index = (t: number): number => (t < since ? -1 : Math.floor((t - since) / step))
    const count = Math.max(0, index(to) - index(from))
    return count > 0 ? { count, latest: since + index(to) * step } : { count: 0 }
  }
  let count = 0
  let latest: number | undefined
  let cursor = from
  while (count < MISSED_COUNT_CAP) {
    const at = nextFireAt(schedule, since, cursor)
    if (at === undefined || at > to) break
    count++
    latest = at
    cursor = at
  }
  return latest === undefined ? { count: 0 } : { count, latest }
}

export type SchedulePreview = { ok: true; next: number[] } | { ok: false; error: string }

/** The next `count` fire times of a schedule; `{ ok: false }` when a cron expression is invalid or nothing is left. */
export function previewSchedule(schedule: TaskSchedule, now: number, count = PREVIEW_COUNT): SchedulePreview {
  if (schedule.kind === 'interval') {
    const next: number[] = []
    let t = now
    for (let i = 0; i < count; i++) {
      t = nextIntervalAt(schedule.everyMinutes, now, t)
      next.push(t)
    }
    return { ok: true, next }
  }
  if (schedule.kind === 'once')
    return schedule.at > now ? { ok: true, next: [schedule.at] } : { ok: false, error: 'in the past' }
  const pattern = cronPatternFor(schedule)
  if (!pattern) return { ok: false, error: 'unsupported schedule' }
  try {
    const job = new Cron(pattern, { paused: true })
    const runs = job.nextRuns(count, new Date(now)).map((d) => d.getTime())
    job.stop()
    if (runs.length === 0) return { ok: false, error: 'never fires' }
    return { ok: true, next: runs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
