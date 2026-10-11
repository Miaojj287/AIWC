/**
 * Small in-stream pieces: timeline markers (compaction, a stopped turn), the plan checklist and the turn-end loader.
 */
import { ArrowRight, CheckCircle2, Circle, CircleAlert, RefreshCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT, type MessageKey } from '@/i18n'
import { Button, cn, formatTokens, ICON_STROKE, Spinner } from '@/kit'
import type { PlanStepStatus, ThreadItem } from '../model'

export type CompactionItem = Extract<ThreadItem, { kind: 'compaction' }>
export type AbortedItem = Extract<ThreadItem, { kind: 'aborted' }>
export type PlanItem = Extract<ThreadItem, { kind: 'plan' }>

/** A centred label between two hairlines: an event on the timeline, not a message. */
function TimelineMarker({ children, item }: { children: ReactNode; item: string }) {
  return (
    <div data-item={item} className="flex w-full min-w-0 items-center gap-3">
      <span aria-hidden className="h-px flex-1 bg-line-8" />
      <span className="flex min-w-0 max-w-[80%] items-center gap-1.5 text-caption text-fg-3">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line-8" />
    </div>
  )
}

export function CompactionNotice({
  item,
  onViewSummary,
}: {
  item: CompactionItem
  onViewSummary?: (item: CompactionItem) => void
}) {
  const t = useT()
  const text =
    item.freedTokens !== undefined
      ? t('agent.compaction.freed', { tokens: formatTokens(item.freedTokens) })
      : item.foldedItemCount
        ? t('agent.compaction.folded', { n: item.foldedItemCount })
        : t('agent.compaction.done')
  return (
    <TimelineMarker item="compaction">
      <span className="min-w-0 truncate">{text}</span>
      {onViewSummary ? (
        <Button variant="link" size="sm" onClick={() => onViewSummary(item)} className="h-5 shrink-0 px-1 text-caption">
          {t('agent.compaction.viewSummary')}
        </Button>
      ) : null}
    </TimelineMarker>
  )
}

/** Why a turn stopped early — the in-stream marker and the live region (TurnAnnouncer) say the same words. */
export const ABORT_TEXT: Record<AbortedItem['reason'], MessageKey> = {
  interrupted: 'agent.turn.aborted.interrupted',
  replaced: 'agent.turn.aborted.replaced',
  step_cap: 'agent.turn.aborted.stepCap',
  loop_guard: 'agent.turn.aborted.loopGuard',
  timeout: 'agent.turn.aborted.timeout',
  error: 'agent.turn.aborted.error',
}

export function AbortedNotice({ item }: { item: AbortedItem }) {
  const t = useT()
  return (
    <TimelineMarker item="aborted">
      <span className="min-w-0 truncate">{t(ABORT_TEXT[item.reason])}</span>
    </TimelineMarker>
  )
}

/** Inside a turn's work: the reply above was a draft that a check sent back, and the answer below replaces it. */
export function RevisionNotice() {
  const t = useT()
  return (
    <TimelineMarker item="revision">
      <RefreshCcw size={12} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{t('agent.turn.revised')}</span>
    </TimelineMarker>
  )
}

/** Decorative; the status itself is the visually hidden word from PLAN_STATUS_TEXT. */
const PLAN_ICON: Record<PlanStepStatus, ReactNode> = {
  done: <CheckCircle2 size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-ok" />,
  doing: <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-accent" />,
  todo: <Circle size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

/** Same words as the tool rows: a step is waiting, running, done or failed. */
const PLAN_STATUS_TEXT: Record<PlanStepStatus, MessageKey> = {
  todo: 'agent.tool.status.pending',
  doing: 'agent.tool.status.running',
  done: 'agent.tool.status.done',
  failed: 'agent.tool.status.error',
}

/** The agent's checklist: done steps are struck through, the current one points forward. */
export function PlanCard({ item }: { item: PlanItem }) {
  const t = useT()
  const done = item.steps.filter((s) => s.status === 'done').length
  const complete = item.steps.length > 0 && done === item.steps.length
  return (
    <div data-item="plan" className="flex w-full flex-col gap-0.5 rounded-card border border-line-8 bg-panel p-2">
      <div className="flex h-7 items-center justify-between px-2 text-body text-fg-2">
        <span>{t('agent.plan.title')}</span>
        <span className={cn('font-latin tabular-nums', complete ? 'text-ok-ink' : 'text-fg-3')}>
          {done}/{item.steps.length}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {item.steps.map((s, i) => (
          <li
            key={i}
            data-status={s.status}
            className="flex min-h-7 items-start gap-2 rounded-item px-2 py-1 text-body leading-5"
          >
            <span className="flex h-5 shrink-0 items-center">{PLAN_ICON[s.status]}</span>
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                s.status === 'done'
                  ? 'text-fg-3 line-through'
                  : s.status === 'failed'
                    ? 'text-danger-ink'
                    : s.status === 'doing'
                      ? 'text-fg'
                      : 'text-fg-2',
              )}
            >
              {s.title}
            </span>
            <span className="sr-only">{t(PLAN_STATUS_TEXT[s.status])}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export type TurnPhase = 'generating' | 'thinking' | 'executing' | 'replying'

/**
 * The single busy mark at the end of a running turn. The visible state lives on the element doing the work (the
 * thinking row and running tools shimmer, the reply streams in); the live region still names the phase, and while
 * an approval is open the turn is blocked on the user, so the spinner gives way to that sentence.
 */
export function TurnLoader({ phase, awaitingApproval = false }: { phase: TurnPhase; awaitingApproval?: boolean }) {
  const t = useT()
  return (
    <div data-item="streaming" className="flex min-h-5 w-full items-center">
      {awaitingApproval ? null : <Spinner size={16} className="text-fg-3" />}
      <span role="status" className="sr-only">
        {awaitingApproval ? t('agent.turn.awaitingApproval') : t(`agent.turn.${phase}`)}
      </span>
    </div>
  )
}
