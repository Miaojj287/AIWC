/**
 * 最近运行 — one row per run: status, trigger, when, how long, how many tool calls; the agent's closing
 * summary; the calls the task's mode did not allow, with a 改为 X 并重跑 shortcut when a higher mode
 * would have; 打开对话 jumps to the run's thread in the Agent panel.
 */
import { Check, MessageSquare, SkipForward, Square, X } from 'lucide-react'
import {
  permissionModeFor,
  type PermissionMode,
  type ScheduledTask,
  type TaskRun,
  type TaskRunStatus,
} from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ICON_STROKE,
  permissionModeName,
  Spinner,
  cn,
  type IconComponent,
} from '@/kit'
import { formatDateTime, formatDuration } from '@/platform/format'
import { stopTask } from '../TaskList'

export interface RunsCardProps {
  task: ScheduledTask
  runs: TaskRun[] | undefined
  busy: boolean
  onRaiseMode(mode: PermissionMode): void
}

const STATUS_ICON: Record<Exclude<TaskRunStatus, 'running'>, { icon: IconComponent; className: string }> = {
  done: { icon: Check, className: 'bg-ok/14 text-ok' },
  failed: { icon: X, className: 'bg-danger/14 text-danger' },
  cancelled: { icon: Square, className: 'bg-line-8 text-fg-3' },
  skipped: { icon: SkipForward, className: 'bg-warn/14 text-warn' },
}

const MODE_RANK: Record<PermissionMode, number> = { ask: 0, bypass: 1, autopilot: 2 }

export function RunsCard({ task, runs, busy, onRaiseMode }: RunsCardProps) {
  const t = useT()
  if (!runs || runs.length === 0)
    return (
      <Card>
        <EmptyState compact variant={runs ? 'empty' : 'loading'} title={t('tasks.editor.runs.empty')} />
      </Card>
    )
  return (
    <Card variant="rows">
      <ul className="flex flex-col divide-y divide-line-6">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} task={task} busy={busy} onRaiseMode={onRaiseMode} />
        ))}
      </ul>
    </Card>
  )
}

function RunRow({ run, task, busy, onRaiseMode }: { run: TaskRun } & Omit<RunsCardProps, 'runs'>) {
  const t = useT()
  const meta = [
    formatDateTime(run.startedAt),
    run.durationMs !== undefined ? formatDuration(run.durationMs) : undefined,
    run.toolCalls > 0 ? t('tasks.editor.runs.tools', { n: run.toolCalls }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  // The mode a rerun needs — offered only when it is higher than what the task already has.
  const needed = run.denied.length ? permissionModeFor(run.denied) : undefined
  const raiseTo = needed && MODE_RANK[needed] > MODE_RANK[task.permissionMode] ? needed : undefined
  const destructive = run.denied.some((d) => d.risk === 'destructive')
  return (
    <li className="flex gap-3 px-4 py-3">
      <StatusIcon status={run.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-body font-medium text-fg">{t(`tasks.editor.status.${run.status}`)}</span>
          <Badge tone="neutral">{t(`tasks.editor.runs.trigger.${run.trigger}`)}</Badge>
          {run.denied.length ? (
            <Badge tone="warn">{t('tasks.editor.runs.denied', { n: run.denied.length })}</Badge>
          ) : null}
          <span className="ml-auto text-micro text-fg-3">{meta}</span>
        </div>
        {run.status === 'skipped' ? (
          <p className="text-caption text-fg-3">{t('tasks.editor.runs.skippedHint')}</p>
        ) : run.status === 'failed' && run.error ? (
          <p className="text-caption text-danger">{run.error}</p>
        ) : null}
        {run.summary ? (
          <p className="whitespace-pre-wrap text-caption text-fg-2" title={run.summary}>
            {run.summary}
          </p>
        ) : run.status === 'done' ? (
          <p className="text-caption text-fg-3">{t('tasks.editor.runs.noSummary')}</p>
        ) : null}
        {run.denied.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-micro text-fg-3">{t('tasks.editor.runs.deniedTitle')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {run.denied.map((d) => (
                <Chip key={d.key} label={d.key} className="font-mono" title={d.summary} />
              ))}
              {raiseTo ? (
                <Button variant="link" size="sm" disabled={busy} onClick={() => onRaiseMode(raiseTo)}>
                  {t('tasks.editor.runs.raiseAndRerun', { mode: permissionModeName(raiseTo) })}
                </Button>
              ) : null}
            </div>
            {destructive ? <span className="text-micro text-fg-3">{t('tasks.editor.runs.deniedManual')}</span> : null}
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          {run.threadId ? (
            <Button
              variant="ghost"
              size="sm"
              icon={MessageSquare}
              onClick={() => runCommand('agent.openThread', { threadId: run.threadId! })}
            >
              {t('tasks.editor.runs.openThread')}
            </Button>
          ) : null}
          {run.status === 'running' ? (
            <Button variant="ghost" size="sm" icon={Square} onClick={() => void stopTask(task, t)}>
              {t('tasks.editor.runs.stop')}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function StatusIcon({ status }: { status: TaskRunStatus }) {
  if (status === 'running')
    return (
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-item bg-accent-15 text-accent">
        <Spinner size={13} />
      </span>
    )
  const { icon: Icon, className } = STATUS_ICON[status]
  return (
    <span aria-hidden className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-item', className)}>
      <Icon size={14} strokeWidth={ICON_STROKE} />
    </span>
  )
}
