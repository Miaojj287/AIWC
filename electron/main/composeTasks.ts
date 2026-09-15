/**
 * 定时任务 wiring for the composition root: the scheduler over the kernel, its prompt wrapper and
 * templates, and how runs reach the user — 'task:changed' / 'task:run' pushes plus a toast per finished
 * run whose action opens the task tab. Each run is a fresh 'cron' thread whose allow-list is the task's
 * grants; the channel never asks, so a run finishes on its own and its report says what was denied.
 */
import type { ToastPayload } from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import type { Broadcast } from './contracts'
import { t } from './i18n'
import { TASK_TEMPLATES, taskRunInput } from './prompts/tasks'
import { createTaskScheduler, type TaskLogger, type TaskScheduler } from './services/taskScheduler'

export interface ComposeTasksDeps {
  dir: string
  kernel: Kernel
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  logger: TaskLogger
}

export function composeTasks(deps: ComposeTasksDeps): TaskScheduler {
  const tasks = createTaskScheduler({
    dir: deps.dir,
    kernel: deps.kernel,
    input: taskRunInput,
    threadTitle: (task) => t('main.tasks.threadTitle', { name: task.name }),
    templates: TASK_TEMPLATES,
    onChanged: (change) => deps.broadcast('task:changed', change),
    onRun: (run) => {
      deps.broadcast('task:run', run)
      if (run.status === 'running' || run.status === 'skipped') return
      const name = tasks.list().find((item) => item.id === run.taskId)?.name ?? run.taskId
      const action = { label: t('main.tasks.viewRun'), command: 'tab.openTask', payload: { id: run.taskId } }
      if (run.status === 'done') {
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
  return tasks
}
