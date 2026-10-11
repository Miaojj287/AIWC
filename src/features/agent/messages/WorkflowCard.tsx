/**
 * The `workflow_run` tool under its row: the plan's steps with ✓ ⟳ ○ ! (done / running / waiting / failed) and why a
 * step did not finish. Live from the call's progress detail, final from its recorded output — so a reloaded
 * conversation shows the same list. Writes inside the steps appear as their own rows (and approvals) next to it.
 * A step whose sub-agent has run opens to that sub-agent's work (live, or its recorded trace), with a link to its
 * full log in a workspace tab.
 */
import { Ban, ChevronRight, Circle, CircleAlert, CircleCheck, CircleMinus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { parseWorkflowView, type WorkflowStepError, type WorkflowStepStatus } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Badge, cn, ICON_STROKE, Spinner, type IconComponent } from '@/kit'
import { formatSeconds, type SubagentRun } from '../model'
import type { ToolCardProps } from '../toolCards'
import { ChildTranscript, OpenRunLog } from './SubagentRuns'

/** Entries of a step's transcript shown inline; the log tab has the rest. */
const STEP_INLINE_ENTRIES = 6

const STATUS_ICON: Record<Exclude<WorkflowStepStatus, 'running'>, { icon: IconComponent; className: string }> = {
  pending: { icon: Circle, className: 'text-fg-3' },
  done: { icon: CircleCheck, className: 'text-ok' },
  failed: { icon: CircleAlert, className: 'text-danger' },
  skipped: { icon: CircleMinus, className: 'text-fg-3' },
  cancelled: { icon: Ban, className: 'text-fg-3' },
}

const STATUS_TEXT: Record<WorkflowStepStatus, MessageKey> = {
  pending: 'agent.workflow.status.pending',
  running: 'agent.workflow.status.running',
  done: 'agent.workflow.status.done',
  failed: 'agent.workflow.status.failed',
  skipped: 'agent.workflow.status.skipped',
  cancelled: 'agent.workflow.status.cancelled',
}

const ERROR_TEXT: Record<WorkflowStepError, MessageKey> = {
  failed: 'agent.workflow.error.failed',
  timeout: 'agent.workflow.error.timeout',
  step_cap: 'agent.workflow.error.step_cap',
  invalid_json: 'agent.workflow.error.invalid_json',
  dependency_failed: 'agent.workflow.error.dependency_failed',
  cancelled: 'agent.workflow.error.cancelled',
}

export function WorkflowCard({ call }: ToolCardProps) {
  const t = useT()
  // The recorded output is final; the progress detail is the live view while the call runs.
  const view = parseWorkflowView(call.output) ?? parseWorkflowView(call.progressDetail)
  if (!view) return null
  const done = view.steps.filter((s) => s.status === 'done').length
  const live = call.status === 'running' || call.status === 'pending'
  return (
    <div className="ml-[7px] flex flex-col gap-1 border-l border-line-8 pl-3.5" aria-label={t('agent.workflow.label')}>
      <span className="text-micro text-fg-3">{t('agent.workflow.progress', { done, total: view.steps.length })}</span>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {view.steps.map((step) => {
          const run = call.children?.find((r) => r.step === step.id)
          // A step still marked running after the call ended was cut off with it.
          const status: WorkflowStepStatus = step.status === 'running' && !live ? 'cancelled' : step.status
          const icon =
            status === 'running' ? (
              <Spinner size={12} className="shrink-0" />
            ) : (
              (() => {
                const { icon: Icon, className } = STATUS_ICON[status]
                return <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden className={cn('shrink-0', className)} />
              })()
            )
          return (
            <StepRow key={step.id} run={run}>
              {icon}
              <span className="sr-only">{t(STATUS_TEXT[status])}</span>
              <span
                title={step.title}
                className={cn(
                  'min-w-0 truncate',
                  status === 'running'
                    ? 'kit-shimmer font-medium text-fg-2'
                    : status === 'done'
                      ? 'text-fg-2'
                      : 'text-fg-3',
                )}
              >
                {step.title}
              </span>
              {step.mode === 'write' ? <Badge tone="neutral">{t('agent.workflow.write')}</Badge> : null}
              {step.error && status !== 'cancelled' ? (
                <span className="min-w-0 shrink truncate text-micro text-danger-ink">{t(ERROR_TEXT[step.error])}</span>
              ) : step.durationMs !== undefined && status === 'done' ? (
                <span className="shrink-0 font-latin text-micro text-fg-3">{formatSeconds(step.durationMs)}</span>
              ) : null}
            </StepRow>
          )
        })}
      </ol>
    </div>
  )
}

/** A step line; with a sub-agent run it toggles that run's transcript and offers its log. */
function StepRow({ run, children }: { run?: SubagentRun; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!run) return <li className="flex min-h-6 min-w-0 items-center gap-2 text-caption">{children}</li>
  return (
    <li className="flex min-w-0 flex-col">
      <div className="group/run flex min-h-6 min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control text-left text-caption outline-none"
        >
          {children}
          <ChevronRight
            size={12}
            strokeWidth={ICON_STROKE}
            aria-hidden
            className={cn(
              'shrink-0 text-fg-3 opacity-0 transition-[opacity,transform] group-hover/run:opacity-100',
              open && 'rotate-90 opacity-100',
            )}
          />
        </button>
        <OpenRunLog run={run} />
      </div>
      {open && run.items.length > 0 ? (
        <div className="ml-[5px] mt-1 mb-1 border-l border-line-8 pl-3.5">
          <ChildTranscript items={run.items} active={run.status === 'running'} limit={STEP_INLINE_ENTRIES} />
        </div>
      ) : null}
    </li>
  )
}
