/**
 * MessageList — renders a thread as turns (DESIGN-SPEC §1.3 消息模型): each prompt opens a TurnView holding the
 * agent's work, the final answer and its action bar; compaction markers stand between turns. It follows the stream
 * while the reader is at the bottom, lets go as soon as they scroll up, and offers a 滚动到底部 button until they
 * return. Wide conversations get the turn navigator rail. Reused by the clone page for the persona chat.
 */
import { ArrowDown, TextQuote } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ApprovalDecision, ApprovalId, DraftAttachment, Mention, TurnId } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { cn, EmptyState, IconButton, ScrollArea, SelectionAction } from '@/kit'
import { findScopeProps, quoteScopeProps } from '@/platform/focusScope'
import { ConversationFind } from './ConversationFind'
import { AGENT_FIND_SCOPE } from './findRequests'
import { userItemText, type ApprovalRequest, type PendingInput, type ThreadItem } from './model'
import type { ArtifactItem } from './messages/ArtifactCard'
import type { AssistantItem, FeedbackVerdict } from './messages/AssistantMessage'
import type { ErrorItem } from './messages/ErrorCard'
import { handleErrorAction, regenerateByResend } from './messages/listActions'
import { type CompactionItem, type TurnPhase } from './messages/Notices'
import { ItemView, TurnView, type ItemActions } from './messages/TurnView'
import { UnansweredNotice } from './messages/UnansweredNotice'
import { UserMessage, type UserItem } from './messages/UserMessage'
import { pendingAsUserItem, placePendingInputs, unansweredPrompt } from './pendingInputs'
import { TurnNavigator, type NavigatorTurn } from './TurnNavigator'
import { useRevealTurn } from './revealTurn'
import { useScrollMemory } from './scrollMemory'
import { answerReplies, buildTimeline } from './turnSegments'

const NO_PENDING: readonly PendingInput[] = []

/** Within this distance of the end the list counts as "at the bottom" and keeps following the stream. */
const BOTTOM_SLOP_PX = 48
/** Exactly at the end (scroll positions are fractional on HiDPI screens). */
const BOTTOM_EXACT_PX = 2

export interface MessageListProps {
  items: ThreadItem[]
  streaming?: boolean
  /** Turn start time for the 工作中 clock (until the prompt itself is recorded). */
  turnStartedAt?: number
  /** The running turn, when known (otherwise taken from the newest item while streaming). */
  activeTurnId?: TurnId
  /** Sent but not yet recorded: a starting turn's prompt, or steers waiting for the current step. */
  pendingInputs?: readonly PendingInput[]
  /** Offers 重新发送 under a last prompt that got no reply; omit to never show that notice. */
  onResendUnanswered?: (item: UserItem) => void
  /** Scroll to the turn holding this item and flash it (a search hit); `onFocusHandled` clears the request. */
  focusItemId?: string
  onFocusHandled?: () => void
  pendingApprovals?: ApprovalRequest[]
  /** History still loading / failed to load. */
  loading?: boolean
  loadError?: string
  onRetryLoad?: () => void
  /** Model display name for the assistant footer (falls back to the item's modelId). */
  modelLabel?: string
  /** Badge rendered above assistant messages (clone page: 分身). */
  assistantBadge?: ReactNode
  /** Extra actions on the final response in a completed turn. */
  assistantExtraActions?: (item: AssistantItem) => ReactNode
  /**
   * Kept for callers that answer approvals themselves; the thread's approvals are answered in the composer slot
   * (ApprovalCard), the transcript only marks the waiting row.
   */
  onResolveApproval?: (approvalId: ApprovalId, decision: ApprovalDecision) => void
  /** 编辑 a user message: parent puts it into the composer. */
  onEdit?: (text: string, mentions: Mention[]) => void
  /** 编辑 in place: the prompt becomes an editor, and sending it rewinds to that turn (wins over `onEdit`). */
  onEditSubmit?: (item: UserItem, text: string, mentions: Mention[]) => void
  /** 从这一轮分出新会话 on finished turns. */
  onFork?: (item: UserItem) => void
  /** Remember / restore the reading position under this key (the thread id) across remounts. */
  scrollKey?: string
  /** Enables the ⌘F find bar; bumped by each request to open it. */
  findRequestSeq?: number
  /** Selecting text in the transcript offers 引用到 Agent, which hands the text here. */
  onQuoteSelection?: (text: string) => void
  /** 重新发送 / 重新生成 / 重试 all resubmit user input. */
  onResend?: (text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: (item: AssistantItem, verdict: FeedbackVerdict) => void
  onOpenArtifact?: (item: ArtifactItem) => void
  onViewSummary?: (item: CompactionItem) => void
  /** Error action 'compact' (open_settings_* are dispatched to the settings tab internally). */
  onCompact?: () => void
  /** Error action 'retry' — defaults to resending the turn's user input through onResend. */
  onRetry?: (item: ErrorItem) => void
  /** What an empty thread shows (default: nothing — the composer beside the list is the whole empty state). */
  emptyState?: ReactNode
  /** Extra space kept free under the last item (the Agent pet perches over the list's bottom edge). */
  bottomInset?: number
  className?: string
  /** Extra classes on the inner column (the Agent window centres it at a reading width). */
  contentClassName?: string
  /** Rendered under each finished turn (本轮改动); undefined for turns that changed nothing. */
  turnFooter?: (turnId: TurnId) => ReactNode
}

export function MessageList({
  items,
  streaming = false,
  turnStartedAt,
  activeTurnId: knownTurnId,
  pendingInputs = NO_PENDING,
  onResendUnanswered,
  focusItemId,
  onFocusHandled,
  pendingApprovals = [],
  loading = false,
  loadError,
  onRetryLoad,
  modelLabel,
  assistantBadge,
  assistantExtraActions,
  onEdit,
  onEditSubmit,
  onFork,
  scrollKey,
  findRequestSeq,
  onQuoteSelection,
  onResend,
  onRegenerate,
  onFeedback,
  onOpenArtifact,
  onViewSummary,
  onCompact,
  onRetry,
  emptyState,
  bottomInset,
  className,
  contentClassName,
  turnFooter,
}: MessageListProps) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  // Set by an upward wheel / key: stay put even inside the bottom slop until the reader reaches the very end.
  const detachedRef = useRef(false)
  const lastTopRef = useRef(0)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  const detach = useCallback(() => {
    followRef.current = false
    detachedRef.current = true
  }, [])
  // Back to where the reader was in this thread (before the follow effect below would pin it to the end).
  const remember = useScrollMemory(viewportRef, scrollKey, items.length > 0 && !loading, detach)

  const onScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap < BOTTOM_EXACT_PX) detachedRef.current = false
    if (gap < BOTTOM_SLOP_PX && !detachedRef.current) followRef.current = true
    else if (el.scrollTop < lastTopRef.current) followRef.current = false
    lastTopRef.current = el.scrollTop
    setAwayFromBottom(gap >= BOTTOM_SLOP_PX)
    remember(gap < BOTTOM_SLOP_PX)
  }, [remember])

  const scrollToBottom = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    followRef.current = true
    detachedRef.current = false
    el.scrollTop = el.scrollHeight
  }, [])

  // A new prompt (sent from here or anywhere) brings the reader to the end, whatever they were reading.
  const promptCount = items.reduce((n, it) => (it.kind === 'user' ? n + 1 : n), 0) + pendingInputs.length
  const promptCountRef = useRef(promptCount)
  // Follow the stream while the reader is at the bottom; leave them alone when they scrolled up.
  const last = items[items.length - 1]
  const lastKey = last
    ? `${last.id}:${last.kind === 'assistant' ? `${last.text.length}:${last.reasoning?.length ?? 0}` : last.kind === 'tools' ? last.calls.map((c) => c.status).join(',') : ''}`
    : ''
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    if (promptCount > promptCountRef.current) {
      followRef.current = true
      detachedRef.current = false
    }
    promptCountRef.current = promptCount
    if (!followRef.current) return
    el.scrollTop = el.scrollHeight
    lastTopRef.current = el.scrollTop
  }, [items.length, lastKey, streaming, pendingApprovals.length, promptCount])

  const onErrorAction = (action: Parameters<typeof handleErrorAction>[0], item: ErrorItem) =>
    handleErrorAction(action, item, {
      items,
      onCompact,
      onRetry,
      onResend,
      onDismiss: (it) => setDismissed((d) => new Set(d).add(it.id)),
    })
  const regenerate = onRegenerate ?? regenerateByResend(items, onResend)

  const visible = useMemo(
    () =>
      items.filter(
        (it) => !dismissed.has(it.id) && (it.kind !== 'assistant' || it.text.trim() || it.reasoning?.trim()),
      ),
    [items, dismissed],
  )
  const latestTurnItem = [...items].reverse().find((item) => 'turnId' in item && item.turnId !== undefined)
  const activeTurnId = streaming
    ? (knownTurnId ?? (latestTurnItem && 'turnId' in latestTurnItem ? latestTurnItem.turnId : undefined))
    : undefined
  const { timeline, trailing } = useMemo(
    () => placePendingInputs(buildTimeline(visible, { streaming, activeTurnId, turnStartedAt }), pendingInputs),
    [visible, streaming, activeTurnId, turnStartedAt, pendingInputs],
  )
  const unanswered =
    onResendUnanswered && !streaming && pendingInputs.length === 0 && pendingApprovals.length === 0
      ? unansweredPrompt(items)
      : undefined

  // A search hit: once the transcript holds the item, bring its turn into view and flash it (CLAUDE.md §13).
  const flashKey = useRevealTurn({
    viewportRef,
    timeline,
    focusItemId,
    loading,
    onHandled: onFocusHandled,
    onDetach: detach,
  })
  const navigatorTurns = useMemo<NavigatorTurn[]>(
    () =>
      timeline.flatMap((entry) => {
        if (entry.kind !== 'segment' || !entry.segment.user) return []
        const { segment } = entry
        const answer = answerReplies(segment)
        const reply =
          answer[0]?.text ??
          segment.body.find((it): it is AssistantItem => it.kind === 'assistant' && it.text.trim() !== '')?.text ??
          ''
        return [
          {
            key: segment.key,
            prompt: userItemText(segment.user?.content ?? []),
            reply,
            running: segment.status === 'running',
          },
        ]
      }),
    [timeline],
  )

  if (loadError) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <EmptyState
          variant="error"
          title={t('agent.thread.loadFailed')}
          description={loadError}
          compact
          action={onRetryLoad ? { label: t('common.retry'), onClick: onRetryLoad } : undefined}
        />
      </div>
    )
  }
  if (loading && items.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <EmptyState variant="loading" title={t('agent.thread.loading')} compact />
      </div>
    )
  }
  if (items.length === 0 && !streaming && pendingInputs.length === 0) {
    return <div className={cn('h-full', className)}>{emptyState}</div>
  }

  const phase: TurnPhase =
    latestTurnItem?.kind === 'tools' &&
    latestTurnItem.calls.some((call) => call.status === 'running' || call.status === 'pending')
      ? 'executing'
      : latestTurnItem?.kind === 'assistant' && latestTurnItem.streaming
        ? latestTurnItem.text.trim()
          ? 'replying'
          : latestTurnItem.reasoning?.trim()
            ? 'thinking'
            : 'generating'
        : 'generating'
  const itemActions: ItemActions = {
    assistantBadge,
    onEdit,
    // A rewind waits for the running turn to end (CLAUDE.md §5): no in-place edit while streaming.
    onEditSubmit: streaming ? undefined : onEditSubmit,
    onFork,
    onResend: streaming ? undefined : onResend,
    onRegenerate: streaming ? undefined : regenerate,
    onOpenArtifact,
    onViewSummary,
    onErrorAction,
  }

  return (
    <div
      className={cn('@container/conversation relative h-full w-full', className)}
      {...(findRequestSeq !== undefined ? findScopeProps(AGENT_FIND_SCOPE) : {})}
    >
      <ScrollArea
        className="h-full w-full"
        viewportRef={viewportRef}
        onScrollCapture={onScroll}
        onWheelCapture={(e) => {
          if (e.deltaY < 0) detach()
        }}
        onKeyDownCapture={(e) => {
          if (e.key === 'PageUp' || e.key === 'Home' || (e.key === 'ArrowUp' && e.target === viewportRef.current))
            detach()
        }}
      >
        <div
          ref={contentRef}
          className={cn('flex min-h-full flex-col gap-8 px-4 pb-4 pt-4', contentClassName)}
          {...(onQuoteSelection ? quoteScopeProps() : {})}
          data-testid="message-list"
          style={bottomInset ? { paddingBottom: bottomInset } : undefined}
        >
          {timeline.map((entry) =>
            entry.kind === 'standalone' ? (
              <ItemView
                key={entry.item.id}
                {...itemActions}
                item={entry.item}
                active={false}
                reasoningActive={false}
                hideReasoning={false}
                isFinal={false}
              />
            ) : (
              <TurnView
                key={entry.segment.key}
                {...itemActions}
                segment={entry.segment}
                phase={phase}
                latestItemId={latestTurnItem?.id}
                pendingApprovals={pendingApprovals}
                modelLabel={modelLabel}
                assistantExtraActions={assistantExtraActions}
                onFeedback={onFeedback}
                flash={flashKey === entry.segment.key}
                footer={entry.segment.turnId ? turnFooter?.(entry.segment.turnId) : undefined}
              />
            ),
          )}
          {trailing.map((input) => (
            <UserMessage
              key={input.clientInputId}
              item={pendingAsUserItem(input, activeTurnId)}
              pendingNote={pendingApprovals.length > 0 ? t('agent.pending.awaitingApproval') : t('agent.pending.steer')}
            />
          ))}
          {unanswered && onResendUnanswered ? (
            <UnansweredNotice key={unanswered.id} item={unanswered} onResend={onResendUnanswered} />
          ) : null}
        </div>
      </ScrollArea>
      <TurnNavigator turns={navigatorTurns} viewportRef={viewportRef} />
      {findRequestSeq !== undefined ? <ConversationFind viewportRef={viewportRef} requestSeq={findRequestSeq} /> : null}
      {onQuoteSelection ? (
        <SelectionAction
          containerRef={contentRef}
          icon={TextQuote}
          label={t('agent.stream.quoteSelection')}
          onAction={onQuoteSelection}
        />
      ) : null}
      {awayFromBottom && timeline.length > 0 ? (
        <IconButton
          icon={ArrowDown}
          label={t('agent.thread.scrollToBottom')}
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-chip border border-(--line-16) bg-content shadow-toast"
          style={bottomInset ? { bottom: bottomInset } : undefined}
        />
      ) : null}
    </div>
  )
}
