/**
 * Small in-stream pieces: compaction bar, aborted notice, plan card, streaming indicator,
 * suggestion buttons and the empty-thread state (Figma 150:1056 / 1095 / 1116).
 */
import { Check, Circle, CircleAlert, Clock, Layers, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useT, type MessageKey } from '@/i18n'
import { Button, cn, EmptyState, formatTokens, ICON_STROKE, Spinner } from '@/kit'
import { formatSeconds, type PlanStepStatus, type ThreadItem } from '../model'

export type CompactionItem = Extract<ThreadItem, { kind: 'compaction' }>
export type AbortedItem = Extract<ThreadItem, { kind: 'aborted' }>
export type PlanItem = Extract<ThreadItem, { kind: 'plan' }>

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
    <div
      data-item="compaction"
      className="flex h-[26px] w-full items-center gap-2 rounded-control bg-hover-5 pl-2.5 pr-1"
    >
      <Layers size={12} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 truncate text-caption text-fg-2">{text}</span>
      {onViewSummary ? (
        <Button variant="link" size="sm" onClick={() => onViewSummary(item)} className="h-5 px-1.5 text-caption">
          {t('agent.compaction.viewSummary')}
        </Button>
      ) : null}
    </div>
  )
}

const ABORT_TEXT: Record<AbortedItem['reason'], MessageKey> = {
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
    <div data-item="aborted" className="flex w-full items-center justify-center py-0.5 text-micro text-fg-3">
      {t(ABORT_TEXT[item.reason])}
    </div>
  )
}

/** `doing` is a Spinner built at render time: its label is copy. */
const PLAN_ICON: Record<Exclude<PlanStepStatus, 'doing'>, ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

export function PlanCard({ item }: { item: PlanItem }) {
  const t = useT()
  const done = item.steps.filter((s) => s.status === 'done').length
  return (
    <div
      data-item="plan"
      className="flex w-full flex-col gap-1.5 rounded-item border border-line-6 bg-content px-2.5 py-2"
    >
      <div className="flex items-center justify-between text-micro text-fg-3">
        <span>{t('agent.plan.title')}</span>
        <span className="font-latin">
          {done} / {item.steps.length}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {item.steps.map((s, i) => (
          <li key={i} data-status={s.status} className="flex h-[22px] items-center gap-2">
            <span className="flex size-[13px] shrink-0 items-center justify-center">
              {s.status === 'doing' ? <Spinner size={13} label={t('agent.plan.doing')} /> : PLAN_ICON[s.status]}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-caption',
                s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg-2',
              )}
            >
              {s.title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Single turn status. `since` is the turn start time. While an approval is open the turn is
 * not generating but blocked on the user, so the row says so and points at the card above it.
 */
export function StreamingIndicator({
  since,
  awaitingApproval = false,
}: {
  since?: number
  awaitingApproval?: boolean
}) {
  const t = useT()
  const [elapsed, setElapsed] = useState(() => (since ? Date.now() - since : 0))
  useEffect(() => {
    if (!since || awaitingApproval) return
    setElapsed(Date.now() - since)
    const id = setInterval(() => setElapsed(Date.now() - since), 100)
    return () => clearInterval(id)
  }, [since, awaitingApproval])
  return (
    <div data-item="streaming" className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-1.5 text-caption text-fg-2" role="status">
        {awaitingApproval ? (
          <>
            <Clock size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
            <span>{t('agent.turn.awaitingApproval')}</span>
          </>
        ) : (
          <>
            <Spinner size={13} aria-hidden />
            <span>
              {since
                ? t('agent.turn.generatingElapsed', { elapsed: formatSeconds(elapsed) })
                : t('agent.turn.generating')}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export function Suggestions({
  items,
  onPick,
  className,
}: {
  items: string[]
  onPick: (text: string) => void
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-1.5', className)} data-item="suggestions">
      {items.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-control bg-hover-5 px-3 text-caption text-fg-2 outline-none transition-colors hover:bg-hover-7 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <Sparkles size={11} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">{s}</span>
        </button>
      ))}
    </div>
  )
}

/** Empty thread: sparkles box, 新会话, hint and up to three suggested prompts (Figma 150:1095). */
export function EmptyThread({
  suggestions = [],
  onPick,
  title,
}: {
  suggestions?: string[]
  onPick: (text: string) => void
  title?: string
}) {
  const t = useT()
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-4">
      <EmptyState
        icon={Sparkles}
        title={title ?? t('agent.thread.untitled')}
        description={suggestions.length ? t('agent.empty.hintWithSuggestions') : t('agent.empty.hint')}
        className="gap-1.5 px-0 py-0 [&>div:first-child]:bg-accent-15 [&>div:first-child]:text-accent"
      />
      <Suggestions items={suggestions.slice(0, 3)} onPick={onPick} className="max-w-[280px]" />
    </div>
  )
}
