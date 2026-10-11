/**
 * Result card under a task_create / task_update row: the task's name, when it runs next (or that it is paused), and
 * 打开任务, which opens its editor in the workspace (in the Agent window: the workspace pane). The tool returns JSON
 * `{ created | updated: { id, name, enabled, next_run_ms, action } }`; anything else renders nothing.
 */
import { AlarmClock, CalendarClock } from 'lucide-react'
import type { JsonValue } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Button, ICON_STROKE } from '@/kit'
import { formatDateTime } from '@/platform/format'
import type { ToolCardProps } from '../toolCards'

interface TaskSummary {
  id: string
  name: string
  enabled: boolean
  nextRunMs?: number
  remind: boolean
}

/** The task a task_create / task_update result describes, when the output has that shape. */
export function taskFromToolOutput(output: JsonValue | string | undefined): TaskSummary | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const task = output.created ?? output.updated
  if (!task || typeof task !== 'object' || Array.isArray(task)) return undefined
  if (typeof task.id !== 'string' || typeof task.name !== 'string') return undefined
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled !== false,
    ...(typeof task.next_run_ms === 'number' ? { nextRunMs: task.next_run_ms } : {}),
    remind: task.action === 'remind',
  }
}

export function TaskToolCard({ call }: ToolCardProps) {
  const t = useT()
  if (call.status !== 'done') return null
  const task = taskFromToolOutput(call.output)
  if (!task) return null
  const Icon = task.remind ? AlarmClock : CalendarClock
  const when = !task.enabled
    ? t('agent.taskCard.paused')
    : task.nextRunMs
      ? t('agent.taskCard.next', { time: formatDateTime(task.nextRunMs) })
      : t('agent.taskCard.noNext')
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-item border border-line-6 bg-panel px-2.5 py-1.5">
      <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-body font-medium text-fg" title={task.name}>
          {task.name}
        </span>
        <span className="min-w-0 truncate text-caption text-fg-3" title={when}>
          {when}
        </span>
      </div>
      <Button
        size="sm"
        variant="link"
        className="shrink-0"
        onClick={() => runCommand('tab.openTask', { id: task.id, title: task.name })}
      >
        {t('agent.taskCard.open')}
      </Button>
    </div>
  )
}
