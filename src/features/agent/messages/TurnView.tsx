/**
 * One turn of the conversation (a TurnSegment): the prompt bubble, then the agent's side — a 工作中 / 已工作 header,
 * the work (reasoning, tool rows, interim replies), the final answer and a hover action bar. Once a turn finishes
 * with an answer, the work folds behind the header; running, stopped and failed turns stay open.
 */
import { ChevronRight, GitBranch, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { DraftAttachment, ErrorAction, Mention } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { cn, ICON_STROKE, IconButton, Tooltip } from '@/kit'
import { groupWork } from '../exploreRuns'
import type { ApprovalRequest, ThreadItem } from '../model'
import { answerReplies, formatWorkDuration, messageTimeLabel, type TurnSegment } from '../turnSegments'
import { ArtifactCard, type ArtifactItem } from './ArtifactCard'
import { AssistantMessage, type AssistantItem, type FeedbackVerdict } from './AssistantMessage'
import { CopyAction } from './CopyAction'
import { ErrorCard, type ErrorItem } from './ErrorCard'
import {
  AbortedNotice,
  CompactionNotice,
  PlanCard,
  RevisionNotice,
  TurnLoader,
  type CompactionItem,
  type TurnPhase,
} from './Notices'
import { CheckRow, type CheckItem } from './CheckRow'
import { ReasoningSection } from './ReasoningSection'
import { ExploreGroup, ToolCallGroup } from './ToolCallGroup'
import { UserMessage, type UserItem } from './UserMessage'

/** The running header re-reads the clock this often (it shows whole seconds). */
const WORK_TICK_MS = 1000

export interface TurnActions {
  modelLabel?: string
  assistantBadge?: ReactNode
  assistantExtraActions?: (item: AssistantItem) => ReactNode
  onEdit?: (text: string, mentions: Mention[]) => void
  /** 编辑 in place, then rewind to this prompt and run the edited text (wins over `onEdit`). */
  onEditSubmit?: (item: UserItem, text: string, mentions: Mention[]) => void
  /** 从这一轮分出新会话 — offered on finished turns. */
  onFork?: (item: UserItem) => void
  onResend?: (text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: (item: AssistantItem, verdict: FeedbackVerdict) => void
  onOpenArtifact?: (item: ArtifactItem) => void
  onViewSummary?: (item: CompactionItem) => void
  onErrorAction: (action: ErrorAction, item: ErrorItem) => void
}

export interface TurnViewProps extends TurnActions {
  segment: TurnSegment
  /** Phase of the running turn (only read when the segment is running). */
  phase: TurnPhase
  /** Id of the newest item in the thread: its reasoning is the one being written. */
  latestItemId?: string
  pendingApprovals: ApprovalRequest[]
  /** Lit for a moment after a search jumped here, then fades (CLAUDE.md §13). */
  flash?: boolean
  /** Under a finished turn, above its action bar: what the turn changed (本轮改动). */
  footer?: ReactNode
}

export function TurnView({
  segment,
  phase,
  latestItemId,
  pendingApprovals,
  modelLabel,
  assistantExtraActions,
  onFeedback,
  flash = false,
  footer,
  ...itemActions
}: TurnViewProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<FeedbackVerdict | undefined>(undefined)
  const workId = useId()
  const running = segment.status === 'running'
  const { body, answerStart, foldable } = segment
  const answerOnly = answerReplies(segment)
  // A turn that ended on a tool call has no answer block (nothing folds), but its last reply still gets the actions.
  const lastReply = segment.status === 'running' ? undefined : lastTextReply(body)
  const replies = answerOnly.length > 0 ? answerOnly : lastReply ? [lastReply] : []
  const finalItem = replies[replies.length - 1]
  const answerIds = new Set(replies.map((it) => it.id))
  const folded = foldable && !open
  const awaitingApproval = running && pendingApprovals.length > 0
  const user = segment.user
  const fork = user && !running && itemActions.onFork ? () => itemActions.onFork?.(user) : undefined

  const feedback = (v: FeedbackVerdict) => {
    if (!finalItem) return
    const next = verdict === v ? undefined : v
    setVerdict(next)
    if (next) onFeedback?.(finalItem, next)
  }

  const turnChecks = body.filter((it): it is CheckItem => it.kind === 'check')
  // A tool group split around a 查阅 run renders as several slices of the same item: key each by its first call.
  const keyOf = (item: ThreadItem) => (item.kind === 'tools' ? `${item.id}:${item.calls[0]?.callId ?? ''}` : item.id)
  const render = (item: ThreadItem, hideReasoning = false) => (
    <ItemView
      key={keyOf(item)}
      {...itemActions}
      item={item}
      turnChecks={turnChecks}
      active={running}
      reasoningActive={running && phase === 'thinking' && item.id === latestItemId}
      hideReasoning={hideReasoning}
      isFinal={answerIds.has(item.id)}
      onFeedback={onFeedback ? feedback : undefined}
    />
  )

  // Folding splits the body where the answer starts; otherwise every item renders where it arrived. The answer's own
  // reasoning is work too, so it moves into the fold; generated files stay visible either way.
  const split = foldable && answerStart !== undefined
  const work = split ? body.slice(0, answerStart) : body
  const answer = split ? body.slice(answerStart) : []
  const answerReasoning = answer.flatMap((it) =>
    it.kind === 'assistant' && it.reasoning?.trim() ? [{ id: it.id, text: it.reasoning }] : [],
  )
  const keptVisible = folded ? work.filter((it) => it.kind === 'artifact') : []
  const hasAgentSide = running || body.length > 0

  return (
    <section
      className={cn(
        'flex w-full min-w-0 flex-col gap-5 rounded-card',
        flash ? 'bg-accent-12 transition-none' : 'transition-colors duration-(--dur-surface)',
      )}
      data-turn={segment.key}
      data-flash={flash || undefined}
    >
      {user ? (
        <UserMessage
          item={user}
          onEdit={itemActions.onEdit}
          onEditSubmit={
            itemActions.onEditSubmit ? (text, mentions) => itemActions.onEditSubmit?.(user, text, mentions) : undefined
          }
          onFork={fork}
          onResend={itemActions.onResend}
        />
      ) : null}
      {hasAgentSide ? (
        <div className="group/turn flex w-full min-w-0 flex-col gap-4">
          {segment.user ? (
            <WorkHeader segment={segment} open={!folded} onToggle={() => setOpen(!open)} controls={workId} />
          ) : null}
          {folded ? null : (
            <div id={foldable ? workId : undefined} className="flex w-full min-w-0 flex-col gap-4">
              {groupWork(work).map((entry) =>
                entry.kind === 'explore' ? (
                  <ExploreGroup key={entry.id} members={entry.members} active={running} />
                ) : (
                  render(entry.item)
                ),
              )}
              {answerReasoning.map((r) => (
                <ReasoningSection key={`reasoning_${r.id}`} text={r.text} active={false} />
              ))}
            </div>
          )}
          {answer.map((item) => render(item, true))}
          {keptVisible.map((item) => render(item))}
          {running ? <TurnLoader phase={phase} awaitingApproval={awaitingApproval} /> : footer}
          {!running && finalItem ? (
            <div className="-mt-2 flex min-h-6 flex-wrap items-center gap-0.5 text-fg-3 opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100">
              <CopyAction text={replies.map((it) => it.text).join('\n\n')} />
              {itemActions.onRegenerate ? (
                <Tooltip content={t('agent.message.regenerate')}>
                  <IconButton
                    size="sm"
                    icon={RefreshCw}
                    label={t('agent.message.regenerate')}
                    onClick={() => itemActions.onRegenerate?.(finalItem)}
                    className="text-fg-3"
                  />
                </Tooltip>
              ) : null}
              {fork ? (
                <Tooltip content={t('agent.stream.fork.action')}>
                  <IconButton
                    size="sm"
                    icon={GitBranch}
                    label={t('agent.stream.fork.action')}
                    onClick={fork}
                    className="text-fg-3"
                  />
                </Tooltip>
              ) : null}
              {onFeedback ? (
                <>
                  <Tooltip content={t('agent.message.helpful')}>
                    <IconButton
                      size="sm"
                      icon={ThumbsUp}
                      label={t('agent.message.helpful')}
                      active={verdict === 'up'}
                      onClick={() => feedback('up')}
                      className={cn(verdict !== 'up' && 'text-fg-3')}
                    />
                  </Tooltip>
                  <Tooltip content={t('agent.message.notHelpful')}>
                    <IconButton
                      size="sm"
                      icon={ThumbsDown}
                      label={t('agent.message.notHelpful')}
                      active={verdict === 'down'}
                      onClick={() => feedback('down')}
                      className={cn(verdict !== 'down' && 'text-fg-3')}
                    />
                  </Tooltip>
                </>
              ) : null}
              {assistantExtraActions?.(finalItem)}
              <FooterMeta model={modelLabel ?? finalItem.modelId} at={segment.endedAt ?? finalItem.createdAt} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function lastTextReply(body: ThreadItem[]): AssistantItem | undefined {
  for (let i = body.length - 1; i >= 0; i--) {
    const it = body[i]
    if (it?.kind === 'assistant' && it.text.trim()) return it
  }
  return undefined
}

function FooterMeta({ model, at }: { model?: string; at?: number }) {
  const text = [model, messageTimeLabel(at)].filter(Boolean).join(' · ')
  if (!text) return null
  return (
    <span title={text} className="ml-1 min-w-0 truncate font-latin text-caption text-fg-3">
      {text}
    </span>
  )
}

/** Re-render every second while `active`, for the live 工作中 clock. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), WORK_TICK_MS)
    return () => clearInterval(id)
  }, [active])
  return now
}

/**
 * 工作中 12 秒 while running; 已工作 1 分 20 秒 (or 已处理 without recorded times) when done; 已停止 when stopped.
 * The line is a toggle only when there is work to fold.
 */
function WorkHeader({
  segment,
  open,
  onToggle,
  controls,
}: {
  segment: TurnSegment
  open: boolean
  onToggle: () => void
  controls: string
}) {
  const t = useT()
  const running = segment.status === 'running'
  const now = useNow(running)
  const { startedAt, endedAt } = segment
  const label = (() => {
    switch (segment.status) {
      case 'running':
        return startedAt !== undefined
          ? t('agent.turn.working', { duration: formatWorkDuration(now - startedAt) })
          : t('agent.turn.workingNoTime')
      case 'stopped':
        return t('agent.turn.stopped')
      case 'done':
      case 'failed':
        return startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
          ? t('agent.turn.worked', { duration: formatWorkDuration(endedAt - startedAt) })
          : t('agent.turn.workedNoTime')
    }
  })()
  const text = <span className="min-w-0 truncate tabular-nums">{label}</span>
  return (
    <div className="flex w-full border-b border-line-6 pb-2" data-item="work-header">
      {segment.foldable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controls}
          onClick={onToggle}
          className="-mx-1 inline-flex min-w-0 items-center gap-1.5 rounded-control px-1 text-body text-fg-3 outline-none hover:text-fg-2"
        >
          {text}
          <ChevronRight
            size={14}
            strokeWidth={ICON_STROKE}
            aria-hidden
            className={cn('shrink-0 opacity-70 transition-transform', open && 'rotate-90')}
          />
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center text-body text-fg-3">{text}</span>
      )}
    </div>
  )
}

/** What a single item needs; the turn-level bits (footer label, extra actions) stay with TurnView. */
export type ItemActions = Omit<TurnActions, 'modelLabel' | 'assistantExtraActions' | 'onFeedback'>

interface ItemViewProps extends ItemActions {
  item: ThreadItem
  /** The turn is still running (unfinished tool calls shimmer). */
  active: boolean
  reasoningActive: boolean
  hideReasoning: boolean
  /** The turn's final answer: its context menu offers 重新生成 and feedback. */
  isFinal: boolean
  onFeedback?: (verdict: FeedbackVerdict) => void
  /** Every check of the turn: a check row summarises its kind's checks (CheckRow). */
  turnChecks?: readonly CheckItem[]
}

/** One transcript item. Also used by MessageList for items that stand between turns (compaction markers). */
export function ItemView({
  item,
  active,
  reasoningActive,
  hideReasoning,
  isFinal,
  assistantBadge,
  onEdit,
  onEditSubmit,
  onResend,
  onRegenerate,
  onOpenArtifact,
  onViewSummary,
  onErrorAction,
  onFeedback,
  turnChecks,
}: ItemViewProps) {
  const t = useT()
  switch (item.kind) {
    case 'user':
      return (
        <UserMessage
          item={item}
          onEdit={onEdit}
          onEditSubmit={onEditSubmit ? (text, mentions) => onEditSubmit(item, text, mentions) : undefined}
          onResend={onResend}
        />
      )
    case 'assistant':
      return (
        <AssistantMessage
          item={item}
          badge={assistantBadge}
          hideReasoning={hideReasoning}
          reasoningActive={reasoningActive}
          onRegenerate={isFinal ? onRegenerate : undefined}
          onFeedback={isFinal ? onFeedback : undefined}
        />
      )
    case 'tools':
      return <ToolCallGroup item={item} active={active} />
    case 'artifact':
      return <ArtifactCard item={item} onOpen={onOpenArtifact} />
    case 'plan':
      return <PlanCard item={item} />
    case 'compaction':
      return <CompactionNotice item={item} onViewSummary={onViewSummary} />
    case 'error':
      return (
        <ErrorCard
          item={item}
          onAction={onErrorAction}
          onDismiss={(it) => onErrorAction({ label: t('common.close'), action: 'dismiss' }, it)}
        />
      )
    case 'aborted':
      return <AbortedNotice item={item} />
    case 'revision':
      return <RevisionNotice />
    case 'check':
      return <CheckRow item={item} turnChecks={turnChecks ?? [item]} running={active} />
  }
}
