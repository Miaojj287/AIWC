import { Copy, Pencil, RefreshCw } from 'lucide-react'
import type { Mention } from '@aiwc/protocol'
import { cn, ContextMenu, ContextMenuContent, ContextMenuItems, ContextMenuTrigger, IconButton, toast, Tooltip, type MenuSpec } from '@/kit'
import { userItemText, type ThreadItem } from '../model'
import { MentionChips } from './mentionChips'

export type UserItem = Extract<ThreadItem, { kind: 'user' }>

export interface UserMessageProps {
  item: UserItem
  /** 编辑: load text + mentions back into the composer. */
  onEdit?: (text: string, mentions: Mention[]) => void
  /** 重新发送 */
  onResend?: (text: string, mentions: Mention[]) => void
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
    toast.success('已复制')
  } catch {
    toast.error('复制失败')
  }
}

/**
 * User message — content ground card (line-8, r10), mention chips on top, hover reveals
 * 编辑 / 复制 / 重新发送 (Figma 150:954). Right-click offers the same three.
 */
export function UserMessage({ item, onEdit, onResend }: UserMessageProps) {
  const text = userItemText(item.content)
  const menu: MenuSpec = [
    { id: 'edit', label: '编辑', icon: Pencil, disabled: !onEdit, onSelect: () => onEdit?.(text, item.mentions) },
    { id: 'copy', label: '复制', icon: Copy, onSelect: () => void copyText(text) },
    { id: 'resend', label: '重新发送', icon: RefreshCw, disabled: !onResend, onSelect: () => onResend?.(text, item.mentions) },
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative flex w-full flex-col gap-2 rounded-window border border-line-8 bg-content px-3 py-2.5" data-item="user">
          <div className={cn('flex min-h-5 items-center gap-1.5', item.mentions.length === 0 && 'absolute right-2 top-2 min-h-0')}>
            <MentionChips mentions={item.mentions} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" />
            <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {onEdit ? (
                <Tooltip content="编辑">
                  <IconButton size="xs" icon={Pencil} label="编辑" onClick={() => onEdit(text, item.mentions)} className="text-fg-3" />
                </Tooltip>
              ) : null}
              <Tooltip content="复制">
                <IconButton size="xs" icon={Copy} label="复制" onClick={() => void copyText(text)} className="text-fg-3" />
              </Tooltip>
              {onResend ? (
                <Tooltip content="重新发送">
                  <IconButton size="xs" icon={RefreshCw} label="重新发送" onClick={() => onResend(text, item.mentions)} className="text-fg-3" />
                </Tooltip>
              ) : null}
            </div>
          </div>
          <p className={cn('m-0 whitespace-pre-wrap break-words text-body leading-5 text-fg select-text', item.mentions.length === 0 && 'pr-16')}>{text}</p>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
