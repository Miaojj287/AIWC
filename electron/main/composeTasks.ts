/**
 * 定时任务 wiring for the composition root: the scheduler over the kernel, its prompt wrapper and
 * templates, and how runs reach the user — 'task:changed' / 'task:run' pushes plus a toast per finished
 * run whose action opens the task tab. Each run is a fresh 'cron' thread whose allow-list is the task's
 * grants; the channel never asks, so a run finishes on its own and its report says what was denied.
 */
import { asThreadId, type ScheduledTask, type TaskRun, type ToastPayload } from '@aiwc/protocol'
import type { Kernel, ToolRegistry } from '@aiwc/kernel'
import type { Broadcast } from './contracts'
import { t } from './i18n'
import { TASK_TEMPLATES, taskRunInput } from './prompts/tasks'
import { taskTools } from './prompts/taskTools'
import type { AttentionNotice } from './services/systemNotifier'
import { createTaskScheduler, type TaskLogger, type TaskScheduler } from './services/taskScheduler'

export interface ComposeTasksDeps {
  dir: string
  kernel: Kernel
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  /** A finished run also raises a system notification while the window is in the background. */
  notify?(run: TaskRun, taskName: string): void
  /** Every run that reached an end state, with its task (完成后推送到我的微信 hangs off this). */
  onFinished?(run: TaskRun, task: ScheduledTask): void
  /** Where the task_* Agent tools are registered (registry is consulted per step, so after the kernel is fine). */
  registry?: Pick<ToolRegistry, 'register'>
  /** System notification for a reminder (services/systemNotifier.ts decides whether it shows). */
  attention?(notice: AttentionNotice): void
  logger: TaskLogger
}

export function composeTasks(deps: ComposeTasksDeps): TaskScheduler {
  const tasks = createTaskScheduler({
    dir: deps.dir,
    kernel: deps.kernel,
    input: taskRunInput,
    threadTitle: (task) => t('main.tasks.threadTitle', { name: task.name }),
    remind: (task) => deliverReminder(deps, task),
    templates: TASK_TEMPLATES,
    onChanged: (change) => deps.broadcast('task:changed', change),
    onRun: (run) => {
      deps.broadcast('task:run', run)
      if (run.status === 'running' || run.status === 'skipped') return
      const task = tasks.list().find((item) => item.id === run.taskId)
      const name = task?.name ?? run.taskId
      if (task) deps.onFinished?.(run, task)
      const action = { label: t('main.tasks.viewRun'), command: 'tab.openTask', payload: { id: run.taskId } }
      // A reminder already reached the user as the reminder itself.
      if (task?.action === 'remind' && run.status === 'done') return
      deps.notify?.(run, name)
      if (run.status === 'missed') {
        deps.toast({ kind: 'warning', text: t('main.tasks.missed', { name }), action })
      } else if (run.status === 'failed' && run.retryAt) {
        deps.toast({ kind: 'warning', text: t('main.tasks.failedRetrying', { name }), action })
      } else if (run.status === 'done') {
        const denied = run.denied.length
        deps.toast({
          kind: denied ? 'warning' : 'success',
          text: denied ? t('main.tasks.doneWithDenied', { name, n: denied }) : t('main.tasks.done', { name }),
          action,
        })
      } else if (run.status === 'failed') {
        deps.toast({ kind: 'error', text: t('main.tasks.failed', { name }), action, sticky: true })
      }
    },
    logger: deps.logger,
  })
  for (const tool of taskTools(tasks)) deps.registry?.register(tool)
  return tasks
}

/**
 * A `remind` task fires: a system notification, an in-app toast that stays until dismissed, and — when the task was
 * set up from an Agent conversation that still exists — the reminder as a note in that conversation.
 */
async function deliverReminder(deps: ComposeTasksDeps, task: ScheduledTask): Promise<void> {
  const open = task.sourceThreadId
    ? { command: 'agent.openThread', payload: { threadId: task.sourceThreadId } }
    : { command: 'tab.openTask', payload: { id: task.id } }
  deps.attention?.({
    key: `reminder:${task.id}:${Date.now()}`,
    title: t('main.tasks.reminderTitle'),
    body: task.prompt,
    action: open,
  })
  deps.toast({
    kind: 'info',
    text: t('main.tasks.reminder', { text: task.prompt }),
    sticky: true,
    action: { label: t('main.tasks.reminderOpen'), ...open },
  })
  if (!task.sourceThreadId) return
  try {
    await deps.kernel.postNote(asThreadId(task.sourceThreadId), t('main.tasks.reminderNote', { text: task.prompt }))
  } catch (e) {
    // the conversation was deleted since: the notification and toast already delivered the reminder
    deps.logger('debug', 'tasks: reminder note not posted', { id: task.id, error: String(e) })
  }
}
