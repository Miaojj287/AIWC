import { Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, cn, ContextMenu, ContextMenuContent, ContextMenuItems, ContextMenuTrigger, IconButton, Tooltip, type MenuSpec } from '@/kit'
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
  /** Extra hover actions (clone page: 不像). */
  extraActions?: ReactNode
}

/**
 * Agent message — plain Markdown on the panel ground; hover reveals 复制 / 重新生成 / 👍 👎 as
 * IconButtons plus the `model · 3.2s` footer (Figma 150:979). While streaming, three pulsing dots.
 */
export function AssistantMessage({ item, modelLabel, badge, onRegenerate, onFeedback, extraActions }: AssistantMessageProps) {
  const [verdict, setVerdict] = useState<FeedbackVerdict | undefined>(undefined)
  const feedback = (v: FeedbackVerdict) => {
    const next = verdict === v ? undefined : v
    setVerdict(next)
    if (next) onFeedback?.(item, next)
  }
  const footer = [modelLabel ?? item.modelId, formatSeconds(item.durationMs)].filter(Boolean).join(' · ')
  const menu: MenuSpec = [
    { id: 'copy', label: '复制', icon: Copy, onSelect: () => void copyText(item.text) },
    { id: 'regen', label: '重新生成', icon: RefreshCw, disabled: !onRegenerate || item.streaming, onSelect: () => onRegenerate?.(item) },
    ...(onFeedback
      ? [
          { type: 'separator' as const },
          { id: 'up', label: '有帮助', icon: ThumbsUp, onSelect: () => feedback('up') },
          { id: 'down', label: '没帮助', icon: ThumbsDown, onSelect: () => feedback('down') },
        ]
      : []),
  ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex w-full flex-col gap-1.5" data-item="assistant" data-streaming={item.streaming || undefined}>
          {badge ? <div className="flex items-center gap-1.5">{badge}</div> : null}
          {item.text ? <Markdown text={item.text} className="select-text" /> : null}
          {item.streaming ? (
            <div className="flex items-center gap-1 py-1" aria-label="正在生成" role="status">
              <span className="size-1.5 animate-pulse rounded-chip bg-accent [animation-delay:0ms]" />
              <span className="size-1.5 animate-pulse rounded-chip bg-accent [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-chip bg-accent [animation-delay:300ms]" />
            </div>
          ) : (
            <div className="flex h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Button variant="link" size="sm" icon={Copy} onClick={() => void copyText(item.text)} className="h-6 px-1.5 text-fg-3 hover:text-fg">
                复制
              </Button>
              {onRegenerate ? (
                <Button variant="link" size="sm" icon={RefreshCw} onClick={() => onRegenerate(item)} className="h-6 px-1.5 text-fg-3 hover:text-fg">
                  重新生成
                </Button>
              ) : null}
              {onFeedback ? (
                <>
                  <Tooltip content="有帮助">
                    <IconButton size="sm" icon={ThumbsUp} label="有帮助" active={verdict === 'up'} onClick={() => feedback('up')} className={cn(verdict !== 'up' && 'text-fg-3')} />
                  </Tooltip>
                  <Tooltip content="没帮助">
                    <IconButton size="sm" icon={ThumbsDown} label="没帮助" active={verdict === 'down'} onClick={() => feedback('down')} className={cn(verdict !== 'down' && 'text-fg-3')} />
                  </Tooltip>
                </>
              ) : null}
              {extraActions}
              {footer ? <span className="ml-1 truncate font-latin text-micro text-fg-3">· {footer}</span> : null}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
