/**
 * The recovery line of a run record: why a slot was missed and when it was due, that a run is a late catch-up or a
 * retry (n of m), why it failed or was interrupted, and when the scheduler will try again (main-process
 * taskRecovery.ts decides all of it; this only words the codes).
 */
import type { TaskRun } from '@aiwc/protocol'
import { useT, type Translator } from '@/i18n'
import { cn } from '@/kit'
import { formatDateTime } from '@/platform/format'

/** The run's recovery sentences, in reading order; empty when there is nothing to explain. */
export function runRecoveryLines(run: TaskRun, t: Translator): string[] {
  const reason = run.reason ? t(`tasks.editor.runs.reason.${run.reason}`) : undefined
  const due = formatDateTime(run.scheduledFor ?? run.startedAt)
  const lines: string[] = []
  if (run.status === 'missed' && reason)
    lines.push(t('tasks.editor.runs.missedLine', { time: due, n: run.missedCount ?? 1, reason }))
  else if (run.trigger === 'catch_up' && reason)
    lines.push(t('tasks.editor.runs.catchUpLine', { time: due, n: run.missedCount ?? 1, reason }))
  else if ((run.status === 'failed' || run.status === 'interrupted') && reason) lines.push(reason)
  if (run.trigger === 'retry' && run.attempt && run.maxAttempts)
    lines.push(t('tasks.editor.runs.retryOf', { n: run.attempt, m: run.maxAttempts }))
  if (run.retryAt && run.maxAttempts)
    lines.push(
      t('tasks.editor.runs.retryAt', {
        time: formatDateTime(run.retryAt),
        n: (run.attempt ?? 0) + 1,
        m: run.maxAttempts,
      }),
    )
  return lines
}

export function RunRecovery({ run }: { run: TaskRun }) {
  const t = useT()
  const lines = runRecoveryLines(run, t)
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <p key={line} className={cn('text-caption', run.status === 'failed' ? 'text-danger-ink' : 'text-fg-3')}>
          {line}
        </p>
      ))}
    </div>
  )
}
