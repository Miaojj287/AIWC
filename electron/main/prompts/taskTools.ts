/**
 * Agent tools over the 定时任务 scheduler (model-facing text, hence under prompts/): create, list, update and delete tasks from a conversation, including
 * one-shot reminders ("半小时后提醒我…"). A relative time is turned into an absolute one here, against the real
 * clock — the model's idea of "now" is often stale. Creating or editing is a write; a call that leaves an enabled
 * Autopilot task (unattended outward sends) counts as a send, so it is confirmed even in Bypass; deleting is destructive.
 * Results are JSON with the task id, which the panel turns into an 打开任务 link.
 */
import { z } from 'zod'
import {
  defineTool,
  type AnyToolDefinition,
  type JsonValue,
  type PermissionMode,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type TaskSchedule,
  type ToolCallPolicy,
} from '@aiwc/protocol'
import type { TaskScheduler } from '../services/taskScheduler'

/** A one-shot time this little in the past is "now" (the call crossed a minute boundary), not an error. */
const PAST_GRACE_MS = 60_000
const MAX_DELAY_MINUTES = 60 * 24 * 365

const ScheduleInput = z
  .object({
    type: z.enum(['once', 'daily', 'weekly', 'interval', 'cron']).describe('once = 只运行一次；其余为重复'),
    in_minutes: z
      .number()
      .int()
      .min(1)
      .max(MAX_DELAY_MINUTES)
      .optional()
      .describe('once：从现在起多少分钟后（相对时间一律用它，例如「半小时后」= 30）'),
    at: z.string().max(40).optional().describe('once：本地时间 YYYY-MM-DDTHH:mm（绝对时间，例如「明天早上 9 点」）'),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe('daily / weekly：HH:mm'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional().describe('weekly：0=周日 … 6=周六'),
    every_minutes: z.number().int().min(5).max(10_080).optional().describe('interval：每隔多少分钟'),
    expression: z.string().max(100).optional().describe('cron：6 段 cron 表达式（秒 分 时 日 月 周）'),
  })
  .describe('什么时候运行')
type ScheduleInputT = z.infer<typeof ScheduleInput>

const PermissionInput = z
  .enum(['ask', 'bypass', 'autopilot'])
  .optional()
  .describe('无人值守时允许做什么：ask = 只读和记忆；bypass（默认）= 也允许本地写入；autopilot = 也允许对外发送')

const CreateInput = z.object({
  name: z.string().trim().min(1).max(60).describe('任务名，简短'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe('action=agent：到时 Agent 要执行的完整指令；action=remind：提醒的原话（会原样通知用户）'),
  action: z.enum(['agent', 'remind']).default('agent').describe('remind = 到时只提醒用户，不运行模型'),
  schedule: ScheduleInput,
  permission_mode: PermissionInput,
})
type CreateInputT = z.infer<typeof CreateInput>

const UpdateInput = z.object({
  id: z.string().min(1).max(64).describe('task_list 返回的任务 id'),
  name: z.string().trim().min(1).max(60).optional(),
  prompt: z.string().trim().min(1).max(8000).optional(),
  schedule: ScheduleInput.optional(),
  enabled: z.boolean().optional().describe('false = 暂停，true = 恢复'),
  permission_mode: PermissionInput,
})
type UpdateInputT = z.infer<typeof UpdateInput>

const IdInput = z.object({ id: z.string().min(1).max(64) })
type IdInputT = z.infer<typeof IdInput>

/** Turn the model's schedule into the protocol's, resolving relative and local times against `now`. */
export function scheduleFromInput(input: ScheduleInputT, now: number): TaskSchedule {
  switch (input.type) {
    case 'once': {
      if (input.in_minutes !== undefined) return { kind: 'once', at: now + input.in_minutes * 60_000 }
      const at = input.at ? Date.parse(input.at) : Number.NaN
      if (!Number.isFinite(at)) throw new Error('once 需要 in_minutes（相对时间）或 at（本地时间 YYYY-MM-DDTHH:mm）')
      if (at <= now - PAST_GRACE_MS)
        throw new Error('这个时间已经过去了。相对时间请用 in_minutes；绝对时间请确认是将来的时刻')
      return { kind: 'once', at: Math.max(at, now + 1_000) }
    }
    case 'daily':
      if (!input.time) throw new Error('daily 需要 time（HH:mm）')
      return { kind: 'daily', time: input.time }
    case 'weekly':
      if (!input.time || !input.days?.length) throw new Error('weekly 需要 time（HH:mm）和 days')
      return { kind: 'weekly', days: input.days, time: input.time }
    case 'interval':
      if (!input.every_minutes) throw new Error('interval 需要 every_minutes（≥ 5）')
      return { kind: 'interval', everyMinutes: input.every_minutes }
    case 'cron':
      if (!input.expression) throw new Error('cron 需要 expression')
      return { kind: 'cron', expression: input.expression }
  }
}

/**
 * Autopilot lets an unattended run send outward, so any call that leaves an enabled Autopilot task behind is a
 * send — judged on the resulting task, not only the fields in this call (renaming, rescheduling or resuming an
 * Autopilot task re-arms it just the same). It is never allow-listable: each such change is confirmed.
 */
function taskPolicyFor(result: { mode: PermissionMode; enabled: boolean }): ToolCallPolicy {
  return result.mode === 'autopilot' && result.enabled ? { risk: 'send', canAllowAlways: false } : { risk: 'write' }
}

/** Mode and enabled state a task_update call leaves behind (an unknown id fails in execute; judged as a write). */
function updateResult(scheduler: TaskScheduler, input: UpdateInputT): { mode: PermissionMode; enabled: boolean } {
  const existing = scheduler.get(input.id)?.task
  return {
    mode: input.permission_mode ?? existing?.permissionMode ?? 'bypass',
    enabled: input.enabled ?? existing?.enabled ?? false,
  }
}

const localTime = (ms: number | undefined): string | null =>
  ms === undefined ? null : new Date(ms).toLocaleString('zh-CN', { hour12: false })

/** What the model (and the panel's result card) gets back for one task. */
export function taskResult(task: ScheduledTask): Record<string, JsonValue> {
  return {
    id: task.id,
    name: task.name,
    action: task.action,
    enabled: task.enabled,
    schedule: task.schedule,
    permission_mode: task.permissionMode,
    next_run_at: localTime(task.nextRunAt),
    /** For the panel's result card (epoch ms); the model reads next_run_at. */
    next_run_ms: task.nextRunAt ?? null,
    last_run_status: task.lastRunStatus ?? null,
  }
}

export function taskTools(scheduler: TaskScheduler, now: () => number = Date.now): AnyToolDefinition[] {
  const create = defineTool<CreateInputT>({
    name: 'task_create',
    description:
      '创建定时任务：到时由 Agent 无人值守地执行一段指令（action=agent），或只提醒用户（action=remind，例如「半小时后提醒我开会」）。相对时间用 schedule.in_minutes，不要自己换算成绝对时间。',
    inputSchema: CreateInput,
    profiles: ['desktop-chat'],
    risk: 'write',
    // a new task is enabled; its mode defaults to Bypass (ScheduledTaskInputSchema)
    classify: (i) => taskPolicyFor({ mode: i.permission_mode ?? 'bypass', enabled: true }),
    parallelSafe: false,
    summarize: (i) => `创建定时任务：${i.name}`,
    async execute(input, ctx) {
      const draft: ScheduledTaskDraft = {
        name: input.name,
        prompt: input.prompt,
        action: input.action,
        schedule: scheduleFromInput(input.schedule, now()),
        ...(input.permission_mode ? { permissionMode: input.permission_mode } : {}),
        sourceThreadId: ctx.threadId,
      }
      return { content: { created: taskResult(await scheduler.save(draft)) } }
    },
  })

  const list = defineTool<Record<string, never>>({
    name: 'task_list',
    description: '列出所有定时任务（id、名称、时间、是否启用、下次运行时间、上次结果）。',
    inputSchema: z.object({}),
    profiles: ['desktop-chat'],
    risk: 'read',
    parallelSafe: true,
    summarize: () => '查看定时任务',
    async execute() {
      return { content: { tasks: scheduler.list().map(taskResult) } }
    },
  })

  const update = defineTool<UpdateInputT>({
    name: 'task_update',
    description: '修改定时任务：改名、改指令、改时间、暂停（enabled=false）或恢复。只传要改的字段。',
    inputSchema: UpdateInput,
    profiles: ['desktop-chat'],
    risk: 'write',
    classify: (i) => taskPolicyFor(updateResult(scheduler, i)),
    parallelSafe: false,
    summarize: (i) => `修改定时任务：${scheduler.get(i.id)?.task.name ?? i.id}`,
    // the row names the task, which only the scheduler knows: recorded with the call so history reads the same
    describe: (i) => ({ code: 'task_update', params: { name: scheduler.get(i.id)?.task.name ?? i.id } }),
    async execute(input) {
      const found = scheduler.get(input.id)?.task
      if (!found) return { content: `没有 id 为 ${input.id} 的定时任务`, isError: true }
      let task = found
      const changed = input.name ?? input.prompt ?? input.schedule ?? input.permission_mode
      if (changed !== undefined) {
        const { nextRunAt: _next, running: _running, lastRunAt: _at, lastRunStatus: _status, ...base } = task
        task = await scheduler.save({
          ...base,
          ...(input.name ? { name: input.name } : {}),
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(input.schedule ? { schedule: scheduleFromInput(input.schedule, now()) } : {}),
          ...(input.permission_mode ? { permissionMode: input.permission_mode } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        })
      } else if (input.enabled !== undefined) {
        task = await scheduler.setEnabled(task.id, input.enabled)
      }
      return { content: { updated: taskResult(task) } }
    },
  })

  const remove = defineTool<IdInputT>({
    name: 'task_delete',
    description: '删除一个定时任务（连同它的设置；运行记录不再显示）。',
    inputSchema: IdInput,
    profiles: ['desktop-chat'],
    risk: 'destructive',
    parallelSafe: false,
    summarize: (i) => `删除定时任务：${scheduler.get(i.id)?.task.name ?? i.id}`,
    describe: (i) => ({ code: 'task_delete', params: { name: scheduler.get(i.id)?.task.name ?? i.id } }),
    async execute(input) {
      const found = scheduler.get(input.id)?.task
      if (!found) return { content: `没有 id 为 ${input.id} 的定时任务`, isError: true }
      await scheduler.remove(found.id)
      return { content: { deleted: { id: found.id, name: found.name } } }
    },
  })

  return [create, list, update, remove]
}
