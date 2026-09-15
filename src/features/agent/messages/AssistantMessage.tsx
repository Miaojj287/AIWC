import { Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  IconButton,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { Markdown } from '../MarkdownView'
import { formatSeconds, type ThreadItem } from '../model'
import { copyText } from './UserMessage'

export type AssistantItem = Extract<ThreadItem, { kind: 'assistant' }>
export type FeedbackVerdict = 'up' | 'down'

export interface AssistantMessageProps {
  item: AssistantItem
  /** Display name of the model (falls back to item.modelId). */
  modelLabel?: string
  /** e.g. a 「分身」 Badge on the clone page. */
  badge?: ReactNode
  onRegenerate?: (item: AssistantItem) => void
  onFeedback?: (item: AssistantItem, verdict: FeedbackVerdict) => void
  /** Extra actions (clone page: correction feedback). */
  extraActions?: ReactNode
  /** Only the final response in a completed turn owns the action bar. */
  showActions?: boolean
}

/**
 * Plain Markdown with a persistent action bar for the final response in a completed turn.
 */
export function AssistantMessage({
  item,
  modelLabel,
  badge,
  onRegenerate,
  onFeedback,
  extraActions,
  showActions = true,
}: AssistantMessageProps) {
  const t = useT()
  const [verdict, setVerdict] = useState<FeedbackVerdict | undefined>(undefined)
  const feedback = (v: FeedbackVerdict) => {
    const next = verdict === v ? undefined : v
    setVerdict(next)
    if (next) onFeedback?.(item, next)
  }
  const footer = [modelLabel ?? item.modelId, formatSeconds(item.durationMs)].filter(Boolean).join(' · ')
  const menu: MenuSpec = [
    { id: 'copy', label: t('common.copy'), icon: Copy, onSelect: () => void copyText(item.text) },
    {
      id: 'regen',
      label: t('agent.message.regenerate'),
      icon: RefreshCw,
      disabled: !onRegenerate || item.streaming || !showActions,
      onSelect: () => onRegenerate?.(item),
    },
    ...(onFeedback && showActions && !item.streaming
      ? [
          { type: 'separator' as const },
          { id: 'up', label: t('agent.message.helpful'), icon: ThumbsUp, onSelect: () => feedback('up') },
          { id: 'down', label: t('agent.message.notHelpful'), icon: ThumbsDown, onSelect: () => feedback('down') },
        ]
      : []),
  ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex w-full flex-col gap-1.5"
          data-item="assistant"
          data-streaming={item.streaming || undefined}
        >
          {badge ? <div className="flex items-center gap-1.5">{badge}</div> : null}
          {item.text ? <Markdown text={item.text} className="select-text" /> : null}
          {!item.streaming && showActions && item.text.trim() ? (
            <div className="flex min-h-6 flex-wrap items-center gap-0.5 text-fg-3">
              <Tooltip content={t('common.copy')}>
                <IconButton size="sm" icon={Copy} label={t('common.copy')} onClick={() => void copyText(item.text)} />
              </Tooltip>
              {onRegenerate ? (
                <Tooltip content={t('agent.message.regenerate')}>
                  <IconButton
                    size="sm"
                    icon={RefreshCw}
                    label={t('agent.message.regenerate')}
                    onClick={() => onRegenerate(item)}
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
              {extraActions}
              {footer ? (
                <span title={footer} className="ml-1 min-w-0 truncate font-latin text-micro text-fg-3">
                  · {footer}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
