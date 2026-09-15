/**
 * task:* for the mock bridge (tests + browser previews): tasks live in localStorage, a run is a
 * timer that pushes running → done on 'task:run' with a canned summary (and one denied call so the
 * 授权并重跑 path has something to show). Nothing here is used by the desktop app.
 */
import type { ScheduledTask, ScheduledTaskInput, TaskRun, TaskSchedule, TaskTemplate } from '@aiwc/protocol'
import { ScheduledTaskInputSchema } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const TASKS_KEY = 'aiwc.mock.tasks'
const RUNS_KEY = 'aiwc.mock.taskRuns'
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'morning-brief',
    schedule: { kind: 'daily', time: '08:30' },
    permissionMode: 'bypass',
    prompt:
      '把昨天到现在的新消息做成一份晨报：需要我回复的、约定和待办、值得知道的事，用 remember 记一条「晨报 <日期>」。',
  },
  {
    id: 'unanswered',
    schedule: { kind: 'daily', time: '21:00' },
    permissionMode: 'bypass',
    prompt: '找出今天收到但我没有回复的单聊消息，列成清单：对方是谁、说了什么、等了多久。只列出来，不要替我回复。',
  },
  {
    id: 'feishu-table',
    schedule: { kind: 'interval', everyMinutes: 300 },
    permissionMode: 'autopilot',
    prompt:
      '把最近 5 小时群聊里的新消息汇总成表格（时间、群名、发言人、摘要、是否需要跟进），用 office_push_table 推到飞书「群聊汇总」。',
  },
  {
    id: 'weekly-review',
    schedule: { kind: 'weekly', days: [1], time: '09:00' },
    permissionMode: 'bypass',
    prompt:
      '回顾上周和联系人的互动，找出聊得最多的 5 个人和久未联系又出现的人，把新的认识用 remember 记下来，最后给一段周报式总结。',
  },
]

function nextTimes(schedule: TaskSchedule, now: number, count: number): number[] | undefined {
  const out: number[] = []
  if (schedule.kind === 'interval') {
    for (let i = 1; i <= count; i++) out.push(now + i * schedule.everyMinutes * 60_000)
    return out
  }
  if (schedule.kind === 'cron') {
    if (schedule.expression.trim().split(/\s+/).length !== 6) return undefined
    for (let i = 1; i <= count; i++) out.push(now + i * HOUR)
    return out
  }
  const [h, m] = schedule.time.split(':').map(Number)
  const at = new Date(now)
  at.setHours(h ?? 0, m ?? 0, 0, 0)
  let candidate = at.getTime()
  for (let guard = 0; out.length < count && guard < 60; guard++) {
    if (candidate > now) {
      const day = new Date(candidate).getDay()
      if (schedule.kind === 'daily' || schedule.days.includes(day)) out.push(candidate)
    }
    candidate += DAY
  }
  return out
}

export function taskHandlers(ctx: MockContext): HandlersFor<'task'> {
  type Stored = Omit<ScheduledTask, 'nextRunAt' | 'running'>
  const tasks = new Map<string, Stored>(Object.entries(ctx.kv.get<Record<string, Stored>>(TASKS_KEY, {})))
  const runs: TaskRun[] = ctx.kv.get<TaskRun[]>(RUNS_KEY, [])
  const active = new Map<string, { run: TaskRun; controller: AbortController }>()

  const persist = () => {
    ctx.kv.set(TASKS_KEY, Object.fromEntries(tasks))
    ctx.kv.set(RUNS_KEY, runs.slice(-100))
  }
  const view = (task: Stored): ScheduledTask => {
    const next = task.enabled ? nextTimes(task.schedule, ctx.now(), 1)?.[0] : undefined
    return { ...task, ...(next ? { nextRunAt: next } : {}), ...(active.has(task.id) ? { running: true } : {}) }
  }
  const require = (id: string): Stored => {
    const task = tasks.get(id)
    if (!task) throw new Error(`unknown task: ${id}`)
    return task
  }
  const pushRun = (run: TaskRun) => {
    const idx = runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) runs[idx] = run
    else runs.push(run)
    ctx.emit('task:run', run)
  }

  async function execute(task: Stored, run: TaskRun, controller: AbortController) {
    try {
      await ctx.delay(400, controller.signal)
      run.threadId = ctx.id('thr')
      pushRun({ ...run })
      await ctx.delay(2200, controller.signal)
      run.toolCalls = 3
      if (task.permissionMode !== 'autopilot' && task.prompt.includes('飞书'))
        run.denied.push({
          tool: 'office_push_table',
          key: 'office_push_table',
          risk: 'send',
          summary: 'office_push_table 群聊汇总 · 12 行',
        })
      run.status = 'done'
      run.summary = run.denied.length
        ? '已整理最近 5 小时 4 个群的 12 条消息；推送到飞书需要 Autopilot 模式，已跳过，表格内容留在对话里。'
        : '已把最近 5 小时 4 个群的 12 条消息整理成表并完成。结果见对话。'
    } catch {
      run.status = 'cancelled'
      run.summary = '整理到一半被停止。'
    } finally {
      run.finishedAt = ctx.now()
      run.durationMs = run.finishedAt - run.startedAt
      active.delete(task.id)
      task.lastRunAt = run.startedAt
      task.lastRunStatus = run.status
      persist()
      pushRun({ ...run })
      ctx.emit('task:changed', { reason: 'scheduled', id: task.id })
    }
  }

  return {
    'task:list': () => [...tasks.values()].map(view).sort((a, b) => b.updatedAt - a.updatedAt),
    'task:get': ({ id }) => {
      const task = tasks.get(id)
      if (!task) return undefined
      return {
        task: view(task),
        runs: runs
          .filter((r) => r.taskId === id)
          .slice(-20)
          .reverse(),
      }
    },
    'task:save': (input: ScheduledTaskInput) => {
      const data = ScheduledTaskInputSchema.parse(input)
      if (nextTimes(data.schedule, ctx.now(), 1) === undefined) throw new Error('invalid schedule: bad cron expression')
      const now = ctx.now()
      const existing = data.id ? tasks.get(data.id) : undefined
      const stored: Stored = {
        ...(existing ?? { createdAt: now }),
        ...data,
        id: existing?.id ?? ctx.id('task'),
        updatedAt: now,
      }
      tasks.set(stored.id, stored)
      persist()
      ctx.emit('task:changed', { reason: 'saved', id: stored.id })
      return view(stored)
    },
    'task:delete': ({ id }) => {
      active.get(id)?.controller.abort()
      tasks.delete(id)
      persist()
      ctx.emit('task:changed', { reason: 'deleted', id })
    },
    'task:setEnabled': ({ id, enabled }) => {
      const task = require(id)
      task.enabled = enabled
      task.updatedAt = ctx.now()
      persist()
      ctx.emit('task:changed', { reason: 'toggled', id })
      return view(task)
    },
    'task:runNow': ({ id }) => {
      const task = require(id)
      const current = active.get(id)
      if (current) return current.run
      const run: TaskRun = {
        id: ctx.id('run'),
        taskId: id,
        trigger: 'manual',
        status: 'running',
        startedAt: ctx.now(),
        denied: [],
        toolCalls: 0,
      }
      const controller = new AbortController()
      active.set(id, { run, controller })
      pushRun({ ...run })
      ctx.emit('task:changed', { reason: 'scheduled', id })
      void execute(task, run, controller)
      return run
    },
    'task:cancel': ({ id }) => {
      const current = active.get(id)
      if (!current) return false
      current.controller.abort()
      return true
    },
    'task:runs': (req) => {
      const list = req?.id ? runs.filter((r) => r.taskId === req.id) : runs
      return list.slice(-(req?.limit ?? 50)).reverse()
    },
    'task:templates': () => [...TEMPLATES],
  }
}
