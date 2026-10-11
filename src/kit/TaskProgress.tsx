import { Check, Circle, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from './cn'
import type { ProgressStep, ProgressStepStatus } from './DialogVariants'
import { ICON_STROKE } from './icon'
import { Spinner } from './Spinner'
import { useT } from '@/i18n'

export interface TaskProgressProps {
  state: 'running' | 'failed' | 'done'
  /** The current stage while running ("正在读取微信内存"), or the outcome. One short line. */
  title: ReactNode
  /** What the user should do now, when the stage waits on them. Muted, may wrap. */
  hint?: ReactNode
  /** Right-aligned muted note, e.g. elapsed time. */
  meta?: ReactNode
  steps: readonly ProgressStep[]
  /** Why the task stopped (state 'failed'); shown under the steps in the danger ink. */
  error?: ReactNode
  /** Buttons under the error (重试 …) or after completion. */
  actions?: ReactNode
  /** Shows 取消 while running. */
  onCancel?: () => void
  cancelLabel?: string
  className?: string
}

const STEP_ICON: Record<ProgressStepStatus, ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  doing: <Spinner size={13} />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

const STATE_ICON: Record<TaskProgressProps['state'], ReactNode> = {
  running: <Spinner size={13} />,
  failed: <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
  done: <Check size={14} strokeWidth={2} aria-hidden className="text-ok" />,
}

/**
 * 行内长任务进度 — the inline form of ProgressDialog (CLAUDE.md §4.5) for tasks that belong next to
 * the thing they produce (key acquisition): one line naming the current stage, an optional hint for
 * what the user must do, a compact ✓/⟳/○/! list, and on failure the reason plus its actions.
 */
export function TaskProgress({
  state,
  title,
  hint,
  meta,
  steps,
  error,
  actions,
  onCancel,
  cancelLabel,
  className,
}: TaskProgressProps) {
  const t = useT()
  return (
    <div className={cn('flex flex-col gap-3 rounded-item border border-line-6 bg-content p-3', className)}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center">{STATE_ICON[state]}</span>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'min-w-0 flex-1 truncate text-body font-medium',
              state === 'failed' ? 'text-danger-ink' : 'text-fg',
            )}
            title={typeof title === 'string' ? title : undefined}
          >
            {title}
          </span>
          {meta ? <span className="shrink-0 text-micro text-fg-3 tabular-nums">{meta}</span> : null}
          {state === 'running' && onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {cancelLabel ?? t('kit.dialog.cancel')}
            </Button>
          ) : null}
        </div>
        {hint ? <p className="pl-6 text-caption text-fg-2">{hint}</p> : null}
      </div>
      <ol className="flex flex-col gap-1.5 pl-6">
        {steps.map((s) => (
          <li key={s.id} data-status={s.status} className="flex items-center gap-2 text-tab">
            <span
              key={s.status}
              className={cn('flex size-4 shrink-0 items-center justify-center', s.status === 'done' && 'kit-enter')}
            >
              {STEP_ICON[s.status]}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger-ink' : 'text-fg-2',
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      {error || actions ? (
        <div className="flex flex-col gap-2 pl-6">
          {error ? <p className="text-caption text-danger-ink">{error}</p> : null}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
