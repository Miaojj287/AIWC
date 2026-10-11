/**
 * Scheduled tasks (定时任务): a prompt the agent runs unattended on a schedule. A run is an ordinary
 * kernel thread on the 'cron' channel, so it can read everything the desktop agent can; what it may
 * change or send outside the machine follows the task's permission mode (Ask = reads and memory only,
 * Bypass = local writes too, Autopilot = outward sends too) — nobody is there to answer a confirmation,
 * so a call the mode does not cover is denied and reported instead of asked.
 */
import { z } from 'zod'
import { PermissionModeSchema } from './config'
import type { PermissionMode } from './ops'
import type { ToolRisk } from './tools'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const TaskScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME_RE) }),
  z.object({
    kind: z.literal('weekly'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string().regex(TIME_RE),
  }),
  z.object({
    kind: z.literal('interval'),
    everyMinutes: z
      .number()
      .int()
      .min(5)
      .max(7 * 24 * 60),
  }),
  z.object({ kind: z.literal('cron'), expression: z.string().trim().min(9).max(100) }),
  /** Fires once at `at` (epoch ms), then the task switches itself off. */
  z.object({ kind: z.literal('once'), at: z.number().int().positive() }),
])
export type TaskSchedule = z.infer<typeof TaskScheduleSchema>
export type TaskScheduleKind = TaskSchedule['kind']

export const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const TaskActionSchema = z.enum(['agent', 'remind'])
export type TaskAction = z.infer<typeof TaskActionSchema>

/** `once` = run the latest missed slot once when the app is back (within the window); `skip` = only record it. */
export const TaskCatchUpSchema = z.enum(['skip', 'once'])
export type TaskCatchUp = z.infer<typeof TaskCatchUpSchema>

/** A missed slot older than this is recorded but never run late, whatever the policy. */
export const TASK_CATCH_UP_WINDOW_MS = 12 * 60 * 60_000

export const ScheduledTaskInputSchema = z.object({
  id: z.string().regex(TASK_ID_RE).optional(),
  name: z.string().trim().min(1).max(60),
  prompt: z.string().trim().min(1).max(8000),
  schedule: TaskScheduleSchema,
  enabled: z.boolean().default(true),
  /** Unattended runs default to Bypass: local writes run, outward sends need Autopilot. */
  permissionMode: PermissionModeSchema.default('bypass'),
  model: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).optional(),
  /** `agent` runs the prompt; `remind` only notifies with the prompt as the message (no model call). */
  action: TaskActionSchema.default('agent'),
  /** What a slot missed while the app was closed or the machine asleep does (see TASK_CATCH_UP_WINDOW_MS). */
  catchUp: TaskCatchUpSchema.default('once'),
  /** The Agent thread the task was created from (task_create); a reminder is also posted there. */
  sourceThreadId: z.string().min(1).max(64).optional(),
  /** 完成后推送到我的微信: a finished run's summary (or failure) goes to the owner's own WeChat. Absent = off. */
  pushToPhone: z.boolean().optional(),
})
export type ScheduledTaskInput = z.infer<typeof ScheduledTaskInputSchema>
/** What a caller may send to save a task: fields with defaults (enabled, mode, action, catch-up) may be left out. */
export type ScheduledTaskDraft = z.input<typeof ScheduledTaskInputSchema>

/**
 * `missed` = a slot that passed without a run (app closed, machine asleep); `interrupted` = the app quit or
 * crashed while the run was going; `skipped` = the previous run was still going.
 */
export type TaskRunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'skipped' | 'missed' | 'interrupted'

/** Why a run was missed, skipped or failed — a stable code the UI words. */
export type TaskRunReason =
  | 'app_not_running'
  | 'machine_asleep'
  | 'previous_running'
  | 'model_unavailable'
  | 'rate_limited'
  | 'network'
  | 'empty_result'
  | 'truncated'
  | 'content_filter'
  | 'app_quit'

export interface ScheduledTask extends ScheduledTaskInput {
  id: string
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastRunStatus?: TaskRunStatus
  /** Computed from the schedule while enabled; absent when paused or the expression is invalid. */
  nextRunAt?: number
  /** A run is in progress right now. */
  running?: boolean
}

export interface TaskRunDenied {
  tool: string
  /** The allow key the call was judged by (`shell:lark-cli base`). */
  key: string
  /** Why it was denied: the mode a rerun needs follows from this (write → Bypass, send → Autopilot). */
  risk: ToolRisk
  summary: string
}

/** The lowest permission mode under which every denied call would have run; undefined when none would (destructive). */
export function permissionModeFor(denied: readonly Pick<TaskRunDenied, 'risk'>[]): PermissionMode | undefined {
  if (denied.some((d) => d.risk === 'destructive')) return undefined
  if (denied.some((d) => d.risk === 'send')) return 'autopilot'
  return 'bypass'
}

export interface TaskRun {
  id: string
  taskId: string
  /** The kernel thread the run happened in; open it in the Agent panel to read the transcript. */
  threadId?: string
  /** `catch_up` = a missed slot run late; `retry` = a rerun after a rate limit or network failure. */
  trigger: 'schedule' | 'manual' | 'catch_up' | 'retry'
  status: TaskRunStatus
  reason?: TaskRunReason
  /** The slot this run was for (catch-up and missed runs: the latest slot that passed). */
  scheduledFor?: number
  /** Slots that passed without a run (missed / catch_up). */
  missedCount?: number
  /** Retry number of a `retry` run (1-based), and how many the scheduler allows. */
  attempt?: number
  maxAttempts?: number
  /** A retry is scheduled for this time (set on the failed run it follows). */
  retryAt?: number
  startedAt: number
  finishedAt?: number
  durationMs?: number
  /** The agent's final message, capped. */
  summary?: string
  error?: string
  denied: TaskRunDenied[]
  toolCalls: number
  /** Files the run produced (path-based, capped), opened from the run record. */
  artifacts?: Array<{ title: string; path: string }>
}

/** A starting point offered on the empty state; name / description copy lives in the UI catalogs by id. */
export interface TaskTemplate {
  id: string
  prompt: string
  schedule: TaskSchedule
  /** Set so a task created from the template runs through without a confirmation nobody can answer. */
  permissionMode: PermissionMode
}
