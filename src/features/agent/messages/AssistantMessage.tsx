import { Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '@/i18n'
import { ContextMenu, ContextMenuContent, ContextMenuItems, ContextMenuTrigger, type MenuSpec } from '@/kit'
import { Markdown } from '../MarkdownView'
import type { ThreadItem } from '../model'
import { copyText } from './CopyAction'
import { ReasoningSection } from './ReasoningSection'

export type AssistantItem = Extract<ThreadItem, { kind: 'assistant' }>
export type FeedbackVerdict = 'up' | 'down'

export interface AssistantMessageProps {
  item: AssistantItem
  /** e.g. a 「分身」 Badge on the clone page. */
  badge?: ReactNode
  /** The reasoning is shown elsewhere (inside the turn's work fold), so only the answer renders here. */
  hideReasoning?: boolean
  reasoningActive?: boolean
  /** Final answer of a finished turn: the context menu offers 重新生成 and feedback like the action bar does. */
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: (verdict: FeedbackVerdict) => void
}

/** Assistant prose on the conversation canvas (no bubble): optional reasoning row, then the Markdown answer. */
export function AssistantMessage({
  item,
  badge,
  hideReasoning = false,
  reasoningActive = false,
  onRegenerate,
  onFeedback,
}: AssistantMessageProps) {
  const t = useT()
  const menu: MenuSpec = [
    { id: 'copy', label: t('common.copy'), icon: Copy, onSelect: () => void copyText(item.text) },
    {
      id: 'regen',
      label: t('agent.message.regenerate'),
      icon: RefreshCw,
      disabled: !onRegenerate || item.streaming,
      onSelect: () => onRegenerate?.(item),
    },
    ...(onFeedback && !item.streaming
      ? [
          { type: 'separator' as const },
          { id: 'up', label: t('agent.message.helpful'), icon: ThumbsUp, onSelect: () => onFeedback('up') },
          { id: 'down', label: t('agent.message.notHelpful'), icon: ThumbsDown, onSelect: () => onFeedback('down') },
        ]
      : []),
  ]
  const reasoning = !hideReasoning && item.reasoning?.trim() ? item.reasoning : undefined
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="flex w-full min-w-0 flex-col gap-2"
          data-item="assistant"
          data-streaming={item.streaming || undefined}
        >
          {badge ? <div className="flex items-center gap-1.5">{badge}</div> : null}
          {reasoning ? <ReasoningSection text={reasoning} active={reasoningActive} /> : null}
          {item.text ? <Markdown text={item.text} className="select-text" /> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
