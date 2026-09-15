import { Copy, Pencil, RefreshCw } from 'lucide-react'
import type { Mention } from '@aiwc/protocol'
import { t, useT } from '@/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  IconButton,
  toast,
  Tooltip,
  type MenuSpec,
} from '@/kit'
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
    toast.success(t('agent.message.copied'))
  } catch {
    toast.error(t('common.copyFailed'))
  }
}

/**
 * User message with mentions above the text and persistent actions below it.
 */
export function UserMessage({ item, onEdit, onResend }: UserMessageProps) {
  const t = useT()
  const text = userItemText(item.content)
  const menu: MenuSpec = [
    {
      id: 'edit',
      label: t('common.edit'),
      icon: Pencil,
      disabled: !onEdit,
      onSelect: () => onEdit?.(text, item.mentions),
    },
    { id: 'copy', label: t('common.copy'), icon: Copy, onSelect: () => void copyText(text) },
    {
      id: 'resend',
      label: t('agent.message.resend'),
      icon: RefreshCw,
      disabled: !onResend,
      onSelect: () => onResend?.(text, item.mentions),
    },
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative flex w-full flex-col gap-2 rounded-window border border-line-8 bg-content px-3 py-2.5"
          data-item="user"
        >
          <MentionChips mentions={item.mentions} className="flex min-w-0 flex-wrap items-center gap-1.5" />
          <p className="m-0 whitespace-pre-wrap break-words text-body leading-5 text-fg select-text">{text}</p>
          <div className="flex items-center justify-end">
            <div className="flex shrink-0 items-center gap-0.5">
              {onEdit ? (
                <Tooltip content={t('common.edit')}>
                  <IconButton
                    size="xs"
                    icon={Pencil}
                    label={t('common.edit')}
                    onClick={() => onEdit(text, item.mentions)}
                    className="text-fg-3"
                  />
                </Tooltip>
              ) : null}
              <Tooltip content={t('common.copy')}>
                <IconButton
                  size="xs"
                  icon={Copy}
                  label={t('common.copy')}
                  onClick={() => void copyText(text)}
                  className="text-fg-3"
                />
              </Tooltip>
              {onResend ? (
                <Tooltip content={t('agent.message.resend')}>
                  <IconButton
                    size="xs"
                    icon={RefreshCw}
                    label={t('agent.message.resend')}
                    onClick={() => onResend(text, item.mentions)}
                    className="text-fg-3"
                  />
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
