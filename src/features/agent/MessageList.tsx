/**
 * MessageList — renders a thread's ThreadItems top-down (DESIGN-SPEC §1.3 消息模型): user → assistant
 * text → tool-call group → result card → text → suggestions; plus error cards, compaction bars, the
 * streaming indicator and the empty-thread state. Reused by the clone page for the persona chat.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ApprovalDecision, ApprovalId, ErrorAction, Mention } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { cn, EmptyState, ScrollArea } from '@/kit'
import type { ApprovalRequest, ThreadItem } from './model'
import { ArtifactCard, type ArtifactItem } from './messages/ArtifactCard'
import { AssistantMessage, type AssistantItem, type FeedbackVerdict } from './messages/AssistantMessage'
import { ErrorCard, type ErrorItem } from './messages/ErrorCard'
import { AbortedNotice, CompactionNotice, EmptyThread, PlanCard, StreamingIndicator, Suggestions, type CompactionItem } from './messages/Notices'
import { ToolCallGroup } from './messages/ToolCallGroup'
import { UserMessage } from './messages/UserMessage'

export interface MessageListProps {
  items: ThreadItem[]
  streaming?: boolean
  /** turn start time for the 已用 x.xs counter */
  turnStartedAt?: number
  pendingApprovals?: ApprovalRequest[]
  /** Suggested prompts (empty thread, or after a plan). */
  suggestions?: string[]
  /** History still loading / failed to load. */
  loading?: boolean
  loadError?: string
  onRetryLoad?: () => void
  /** Model display name for the assistant footer (falls back to the item's modelId). */
  modelLabel?: string
  /** Badge rendered above assistant messages (clone page: 分身). */
  assistantBadge?: ReactNode
  /** Extra hover actions on assistant messages. */
  assistantExtraActions?: (item: AssistantItem) => ReactNode
  onSuggestion?: (text: string) => void
  onResolveApproval?: (approvalId: ApprovalId, decision: ApprovalDecision) => void
  onStop?: () => void
  /** 编辑 a user message: parent puts it into the composer. */
  onEdit?: (text: string, mentions: Mention[]) => void
  /** 重新发送 / 重新生成 / 重试 all resubmit user input. */
  onResend?: (text: string, mentions: Mention[]) => void
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: (item: AssistantItem, verdict: FeedbackVerdict) => void
  onOpenArtifact?: (item: ArtifactItem) => void
  onViewSummary?: (item: CompactionItem) => void
  /** Error action 'compact' (open_settings_* are dispatched to the settings tab internally). */
  onCompact?: () => void
  /** Error action 'retry' — defaults to resending the turn's user input through onResend. */
  onRetry?: (item: ErrorItem) => void
  /** Empty-thread title (default 新会话). */
  emptyTitle?: string
  /** Replace the default empty state entirely. */
  emptyState?: ReactNode
  className?: string
}

export function MessageList({
  items,
  streaming = false,
  turnStartedAt,
  pendingApprovals = [],
  suggestions = [],
  loading = false,
  loadError,
  onRetryLoad,
  modelLabel,
  assistantBadge,
  assistantExtraActions,
  onSuggestion,
  onResolveApproval,
  onStop,
  onEdit,
  onResend,
  onRegenerate,
  onFeedback,
  onOpenArtifact,
  onViewSummary,
  onCompact,
  onRetry,
  emptyTitle,
  emptyState,
  className,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  const onScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  // Follow the stream while the user is at the bottom; leave them alone when they scrolled up.
  const last = items[items.length - 1]
  const lastKey = last ? `${last.id}:${last.kind === 'assistant' ? last.text.length : last.kind === 'tools' ? last.calls.map((c) => c.status).join(',') : ''}` : ''
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [items.length, lastKey, streaming, pendingApprovals.length])

  const handleErrorAction = (action: ErrorAction, item: ErrorItem) => {
    switch (action.action) {
      case 'open_settings_ai':
        runCommand('tab.openSettings', { page: 'ai' })
        return
      case 'open_settings_account':
        runCommand('tab.openSettings', { page: 'account' })
        return
      case 'compact':
        onCompact?.()
        return
      case 'retry':
        if (onRetry) onRetry(item)
        else {
          const user = [...items].reverse().find((it) => it.kind === 'user' && (item.turnId === undefined || it.turnId === item.turnId))
          if (user?.kind === 'user') onResend?.(user.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n'), user.mentions)
        }
        return
      case 'dismiss':
        setDismissed((s) => new Set(s).add(item.id))
        return
    }
  }

  const regenerate = onRegenerate ?? (onResend ? (item: AssistantItem) => {
    const user = [...items].reverse().find((it) => it.kind === 'user' && it.turnId === item.turnId)
    if (user?.kind === 'user') onResend(user.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n'), user.mentions)
  } : undefined)

  if (loadError) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <EmptyState variant="error" title="会话加载失败" description={loadError} compact action={onRetryLoad ? { label: '重试', onClick: onRetryLoad } : undefined} />
      </div>
    )
  }
  if (loading && items.length === 0) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <EmptyState variant="loading" title="正在加载会话" compact />
      </div>
    )
  }
  if (items.length === 0 && !streaming) {
    return <div className={cn('h-full', className)}>{emptyState ?? <EmptyThread suggestions={suggestions} onPick={(t) => onSuggestion?.(t)} title={emptyTitle} />}</div>
  }

  const visible = items.filter((it) => !dismissed.has(it.id))
  return (
    <ScrollArea className={cn('h-full w-full', className)} viewportRef={viewportRef} onScrollCapture={onScroll}>
      <div className="flex min-h-full flex-col gap-4 px-4 pb-2 pt-4" data-testid="message-list">
        {visible.map((item) => (
          <ItemView
            key={item.id}
            item={item}
            pendingApprovals={pendingApprovals}
            modelLabel={modelLabel}
            assistantBadge={assistantBadge}
            assistantExtraActions={assistantExtraActions}
            onResolveApproval={onResolveApproval}
            onEdit={onEdit}
            onResend={onResend}
            onRegenerate={regenerate}
            onFeedback={onFeedback}
            onOpenArtifact={onOpenArtifact}
            onViewSummary={onViewSummary}
            onErrorAction={handleErrorAction}
          />
        ))}
        {streaming ? <StreamingIndicator since={turnStartedAt} onStop={onStop} awaitingApproval={pendingApprovals.length > 0} /> : null}
        {!streaming && suggestions.length > 0 && onSuggestion ? <Suggestions items={suggestions} onPick={onSuggestion} className="justify-start" /> : null}
      </div>
    </ScrollArea>
  )
}

interface ItemViewProps {
  item: ThreadItem
  pendingApprovals: ApprovalRequest[]
  modelLabel?: string
  assistantBadge?: ReactNode
  assistantExtraActions?: (item: AssistantItem) => ReactNode
  onResolveApproval?: MessageListProps['onResolveApproval']
  onEdit?: MessageListProps['onEdit']
  onResend?: MessageListProps['onResend']
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: MessageListProps['onFeedback']
  onOpenArtifact?: MessageListProps['onOpenArtifact']
  onViewSummary?: MessageListProps['onViewSummary']
  onErrorAction: (action: ErrorAction, item: ErrorItem) => void
}

function ItemView({ item, pendingApprovals, modelLabel, assistantBadge, assistantExtraActions, onResolveApproval, onEdit, onResend, onRegenerate, onFeedback, onOpenArtifact, onViewSummary, onErrorAction }: ItemViewProps) {
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} onEdit={onEdit} onResend={onResend} />
    case 'assistant':
      return <AssistantMessage item={item} modelLabel={modelLabel} badge={assistantBadge} onRegenerate={onRegenerate} onFeedback={onFeedback} extraActions={assistantExtraActions?.(item)} />
    case 'tools':
      return <ToolCallGroup item={item} pendingApprovals={pendingApprovals} onResolveApproval={onResolveApproval} />
    case 'artifact':
      return <ArtifactCard item={item} onOpen={onOpenArtifact} />
    case 'plan':
      return <PlanCard item={item} />
    case 'compaction':
      return <CompactionNotice item={item} onViewSummary={onViewSummary} />
    case 'error':
      return <ErrorCard item={item} onAction={onErrorAction} onDismiss={(it) => onErrorAction({ label: '关闭', action: 'dismiss' }, it)} />
    case 'aborted':
      return <AbortedNotice item={item} />
  }
}
