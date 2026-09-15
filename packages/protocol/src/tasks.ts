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
])
export type TaskSchedule = z.infer<typeof TaskScheduleSchema>
export type TaskScheduleKind = TaskSchedule['kind']

export const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const ScheduledTaskInputSchema = z.object({
  id: z.string().regex(TASK_ID_RE).optional(),
  name: z.string().trim().min(1).max(60),
  prompt: z.string().trim().min(1).max(8000),
  schedule: TaskScheduleSchema,
  enabled: z.boolean().default(true),
  /** Unattended runs default to Bypass: local writes run, outward sends need Autopilot. */
  permissionMode: PermissionModeSchema.default('bypass'),
  model: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).optional(),
})
export type ScheduledTaskInput = z.infer<typeof ScheduledTaskInputSchema>

export type TaskRunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'

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
  trigger: 'schedule' | 'manual'
  status: TaskRunStatus
  startedAt: number
  finishedAt?: number
  durationMs?: number
  /** The agent's final message, capped. */
  summary?: string
  error?: string
  denied: TaskRunDenied[]
  toolCalls: number
}

/** A starting point offered on the empty state; name / description copy lives in the UI catalogs by id. */
export interface TaskTemplate {
  id: string
  prompt: string
  schedule: TaskSchedule
  /** Set so a task created from the template runs through without a confirmation nobody can answer. */
  permissionMode: PermissionMode
}
