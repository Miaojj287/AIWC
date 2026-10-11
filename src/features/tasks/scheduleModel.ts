/**
 * Pure helpers for 定时任务: the editor draft, its validation, schedule wording for lists and badges,
 * and the list's segment filter. No React, no bridge — unit-tested directly.
 */
import type {
  ModelSelection,
  PermissionMode,
  ScheduledTask,
  TaskAction,
  TaskCatchUp,
  TaskSchedule,
  TaskScheduleKind,
  TaskTemplate,
} from '@aiwc/protocol'
import type { MessageKey, Translator } from '@/i18n'
import { formatDateTime, formatTime } from '@/platform/format'

export interface TaskDraft {
  name: string
  prompt: string
  schedule: TaskSchedule
  enabled: boolean
  /** Unattended runs default to Bypass; a template that sends outward comes with Autopilot. */
  permissionMode: PermissionMode
  model?: ModelSelection
  /** 完成后推送到我的微信. Always sent explicitly so switching it off overwrites a saved `true`. */
  pushToPhone: boolean
  /** Run the agent, or only remind with the prompt text. */
  action: TaskAction
  /** A slot missed while the app was closed / the machine asleep: run it once when back, or only record it. */
  catchUp: TaskCatchUp
  /** Kept as-is when an Agent-created task is edited (its reminder goes back to that conversation). */
  sourceThreadId?: string
}

export type TaskDraftErrors = Partial<
  Record<'name' | 'prompt' | 'time' | 'weekdays' | 'interval' | 'cron' | 'at', string>
>

export type TaskSegment = 'all' | 'on' | 'paused'

export const DEFAULT_TIME = '09:00'
export const DEFAULT_INTERVAL_MINUTES = 300
/** Interval presets offered by the editor (minutes). */
export const INTERVAL_PRESETS: readonly number[] = [30, 60, 120, 180, 300, 360, 720, 1440]
/** Monday-first order for the weekday picker; values are JS getDay() numbers. */
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const TEMPLATE_IDS = new Set(['morning-brief', 'unanswered', 'feishu-table', 'weekly-review'])

export function emptyDraft(template?: TaskTemplate): TaskDraft {
  return {
    name: '',
    prompt: template?.prompt ?? '',
    schedule: template?.schedule ?? { kind: 'daily', time: DEFAULT_TIME },
    enabled: true,
    permissionMode: template?.permissionMode ?? 'bypass',
    pushToPhone: false,
    action: 'agent',
    catchUp: 'once',
  }
}

export function draftFromTask(task: ScheduledTask): TaskDraft {
  return {
    name: task.name,
    prompt: task.prompt,
    schedule: task.schedule,
    enabled: task.enabled,
    permissionMode: task.permissionMode,
    ...(task.model ? { model: task.model } : {}),
    pushToPhone: task.pushToPhone === true,
    action: task.action,
    catchUp: task.catchUp,
    ...(task.sourceThreadId ? { sourceThreadId: task.sourceThreadId } : {}),
  }
}

export function sameDraft(a: TaskDraft, b: TaskDraft): boolean {
  return (
    a.name === b.name &&
    a.prompt === b.prompt &&
    a.enabled === b.enabled &&
    JSON.stringify(a.schedule) === JSON.stringify(b.schedule) &&
    a.permissionMode === b.permissionMode &&
    a.pushToPhone === b.pushToPhone &&
    a.action === b.action &&
    a.catchUp === b.catchUp &&
    JSON.stringify(a.model ?? null) === JSON.stringify(b.model ?? null)
  )
}

/** Switch the schedule kind while keeping what carries over (the time of day, the weekday set). */
export function scheduleOfKind(kind: TaskScheduleKind, previous: TaskSchedule): TaskSchedule {
  const time = 'time' in previous ? previous.time : DEFAULT_TIME
  switch (kind) {
    case 'daily':
      return { kind, time }
    case 'weekly':
      return { kind, days: previous.kind === 'weekly' ? previous.days : [1, 2, 3, 4, 5], time }
    case 'interval':
      return { kind, everyMinutes: DEFAULT_INTERVAL_MINUTES }
    case 'cron':
      return { kind, expression: '' }
    case 'once':
      return { kind, at: nextWholeHour(Date.now()) }
  }
}

/** The start of the next hour (a one-shot's starting value). */
export function nextWholeHour(now: number): number {
  const d = new Date(now)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.getTime()
}

export function validateDraft(draft: TaskDraft, t: Translator, now: number = Date.now()): TaskDraftErrors {
  const errors: TaskDraftErrors = {}
  if (!draft.name.trim()) errors.name = t('tasks.editor.errors.name')
  if (!draft.prompt.trim()) errors.prompt = t('tasks.editor.errors.prompt')
  const s = draft.schedule
  if ((s.kind === 'daily' || s.kind === 'weekly') && !TIME_RE.test(s.time)) errors.time = t('tasks.editor.errors.time')
  if (s.kind === 'weekly' && s.days.length === 0) errors.weekdays = t('tasks.editor.errors.weekdays')
  if (s.kind === 'interval' && (!Number.isInteger(s.everyMinutes) || s.everyMinutes < 5))
    errors.interval = t('tasks.editor.errors.interval')
  if (s.kind === 'cron' && s.expression.trim().split(/\s+/).length < 5) errors.cron = t('tasks.editor.errors.cron')
  // A one-shot that already fired (switched itself off) may still be renamed without moving its time.
  if (s.kind === 'once' && draft.enabled && !(s.at > now)) errors.at = t('tasks.editor.errors.at')
  return errors
}

export function weekdayLabel(day: number, t: Translator): string {
  return t(`tasks.schedule.weekday.d${day}` as MessageKey)
}

/** "每天 08:30" / "每周一、三 09:00" / "每 5 小时" / "Cron 0 0 *\/5 * * *". */
export function describeSchedule(schedule: TaskSchedule, t: Translator): string {
  switch (schedule.kind) {
    case 'daily':
      return t('tasks.schedule.daily', { time: schedule.time })
    case 'weekly': {
      const days = WEEKDAY_ORDER.filter((d) => schedule.days.includes(d))
      if (days.length === 7) return t('tasks.schedule.daily', { time: schedule.time })
      const names = days.map((d) => weekdayLabel(d, t)).join(t('tasks.schedule.weekdaySeparator'))
      return t('tasks.schedule.weekly', { days: names, time: schedule.time })
    }
    case 'interval': {
      const m = schedule.everyMinutes
      if (m % 1440 === 0) return t('tasks.schedule.interval.days', { n: m / 1440 })
      if (m % 60 === 0) return t('tasks.schedule.interval.hours', { n: m / 60 })
      return t('tasks.schedule.interval.minutes', { n: m })
    }
    case 'cron':
      return t('tasks.schedule.cron', { expr: schedule.expression })
    case 'once':
      return t('tasks.schedule.once', { time: formatDateTime(schedule.at) })
  }
}

export interface TaskStatusLine {
  kind: 'running' | 'on' | 'paused' | 'failed'
  text: string
}

/** Second line of a list row: what the task is doing now, else when it runs next, else how the last run went. */
export function taskStatusLine(task: ScheduledTask, t: Translator, now: number = Date.now()): TaskStatusLine {
  if (task.running) return { kind: 'running', text: t('tasks.list.status.running') }
  // A one-shot switches itself off once it fired: say how that went rather than 已暂停.
  if (!task.enabled && task.schedule.kind === 'once' && task.lastRunAt)
    return { kind: 'paused', text: lastRunText(task, t, now) ?? t('tasks.list.status.paused') }
  if (!task.enabled) return { kind: 'paused', text: t('tasks.list.status.paused') }
  if (task.lastRunStatus === 'failed' && task.lastRunAt)
    return { kind: 'failed', text: t('tasks.list.status.lastFailed', { time: formatTime(task.lastRunAt, now) }) }
  if (task.nextRunAt)
    return { kind: 'on', text: t('tasks.list.status.nextAt', { time: formatTime(task.nextRunAt, now) }) }
  return { kind: 'on', text: lastRunText(task, t, now) ?? t('tasks.list.status.never') }
}

export function lastRunText(task: ScheduledTask, t: Translator, now: number = Date.now()): string | undefined {
  if (!task.lastRunAt || !task.lastRunStatus) return undefined
  const time = formatTime(task.lastRunAt, now)
  switch (task.lastRunStatus) {
    case 'done':
      return t('tasks.list.status.lastDone', { time })
    case 'failed':
      return t('tasks.list.status.lastFailed', { time })
    case 'cancelled':
      return t('tasks.list.status.lastCancelled', { time })
    case 'skipped':
      return t('tasks.list.status.lastSkipped', { time })
    case 'missed':
      return t('tasks.list.status.lastMissed', { time })
    case 'interrupted':
      return t('tasks.list.status.lastInterrupted', { time })
    case 'running':
      return t('tasks.list.status.running')
  }
}

export function filterTasks(tasks: readonly ScheduledTask[], query: string, segment: TaskSegment): ScheduledTask[] {
  const q = query.trim().toLowerCase()
  return tasks.filter((task) => {
    if (segment === 'on' && !task.enabled) return false
    if (segment === 'paused' && task.enabled) return false
    return !q || task.name.toLowerCase().includes(q) || task.prompt.toLowerCase().includes(q)
  })
}

export function segmentCounts(tasks: readonly ScheduledTask[]): Record<TaskSegment, number> {
  const on = tasks.filter((t) => t.enabled).length
  return { all: tasks.length, on, paused: tasks.length - on }
}

/** Template copy lives in the catalogs by id; an id the catalog does not know falls back to the id. */
export function templateCopy(id: string, t: Translator): { name: string; description: string } {
  if (!TEMPLATE_IDS.has(id)) return { name: id, description: '' }
  return {
    name: t(`tasks.templates.${id}.name` as MessageKey),
    description: t(`tasks.templates.${id}.description` as MessageKey),
  }
}
