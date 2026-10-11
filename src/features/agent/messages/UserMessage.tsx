import { ChevronDown, ChevronUp, Clock, Copy, GitBranch, Pencil, RefreshCw } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DraftAttachment, Mention } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  ICON_STROKE,
  IconButton,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { userItemPlainText, type ThreadItem } from '../model'
import { endPromptEdit, startPromptEdit, updatePromptEdit, usePromptEditStore } from '../promptEdit'
import { AttachmentList } from '../composer/AttachmentList'
import { draftAttachmentsOf } from '../composer/attachments'
import { CopyAction, copyText } from './CopyAction'
import { MentionChips } from './mentionChips'
import { PromptEditor } from './PromptEditor'

export type UserItem = Extract<ThreadItem, { kind: 'user' }>

/** A prompt taller than this folds behind 展开 (the mask fades its last lines). */
const COLLAPSED_MAX_PX = 120

export interface UserMessageProps {
  item: UserItem
  /** 编辑: load text + mentions back into the composer (used when there is no `onEditSubmit`). */
  onEdit?: (text: string, mentions: Mention[]) => void
  /** 编辑 in place: the bubble becomes an editor; sending rewinds to this turn and runs the edited prompt. */
  onEditSubmit?: (text: string, mentions: Mention[]) => void
  /** 从这一轮分出新会话 (context menu). */
  onFork?: () => void
  /** 重新发送 */
  onResend?: (text: string, mentions: Mention[], attachments?: DraftAttachment[]) => void
  /**
   * Set while the kernel has not recorded this input yet (a steer waiting for the current step): the bubble is muted
   * and the note replaces the action row.
   */
  pendingNote?: string
}

/**
 * The prompt that opens a turn: a right-aligned bubble on the raised ground. A long prompt folds to 120px with a
 * fading edge and a 展开 / 收起 toggle. Copy / edit / resend sit under the bubble and show on hover or keyboard focus
 * (their space is always reserved, so revealing them never moves the transcript).
 */
export function UserMessage({ item, onEdit, onEditSubmit, onFork, onResend, pendingNote }: UserMessageProps) {
  const t = useT()
  // Attachments show as tiles, so the text is the typed text only (also what copy / edit / resend use).
  const text = userItemPlainText(item.content)
  const attachments = useMemo(() => draftAttachmentsOf(item.content), [item.content])
  // Attachments go along only when the prompt had some (a text-only resend keeps its two-argument shape).
  const resendPrompt = () =>
    attachments.length ? onResend?.(text, item.mentions, attachments) : onResend?.(text, item.mentions)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // One prompt is edited at a time, and its text outlives a cancelled rewind confirmation (promptEdit.ts).
  const editing = usePromptEditStore((s) => (s.editing?.itemId === item.id ? s.editing : undefined))
  const canEdit = Boolean(onEditSubmit ?? onEdit)
  // The prompt left the transcript (rewound, thread closed): its edit ends with it.
  useEffect(() => () => endPromptEdit(item.id), [item.id])
  const startEdit = () => {
    if (onEditSubmit) startPromptEdit({ itemId: item.id, text, mentions: item.mentions })
    else onEdit?.(text, item.mentions)
  }

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setOverflows(el.scrollHeight > COLLAPSED_MAX_PX + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  const collapsed = overflows && !expanded
  const menu: MenuSpec = [
    {
      id: 'edit',
      label: t('common.edit'),
      icon: Pencil,
      disabled: !canEdit,
      onSelect: startEdit,
    },
    { id: 'copy', label: t('common.copy'), icon: Copy, onSelect: () => void copyText(text) },
    {
      id: 'resend',
      label: t('agent.message.resend'),
      icon: RefreshCw,
      disabled: !onResend,
      onSelect: () => resendPrompt(),
    },
    ...(onFork
      ? [
          { type: 'separator' as const },
          { id: 'fork', label: t('agent.stream.fork.action'), icon: GitBranch, onSelect: onFork },
        ]
      : []),
  ]
  if (editing && onEditSubmit)
    return (
      <PromptEditor
        text={editing.text}
        mentions={editing.mentions}
        onChange={(next, mentions) => updatePromptEdit(item.id, next, mentions)}
        onCancel={() => endPromptEdit(item.id)}
        // The editor stays until the rewind goes ahead (the prompt then leaves the transcript): a cancelled
        // confirmation or a failed rewind keeps the edit.
        onSubmit={(next, mentions) => onEditSubmit(next, mentions)}
      />
    )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          aria-label={pendingNote ? t('agent.pending.label') : t('agent.message.user')}
          className="group/user flex w-full flex-col items-end"
          data-item="user"
          data-pending={pendingNote ? '' : undefined}
        >
          <div
            className={cn(
              'relative flex max-w-full flex-col gap-2 rounded-card rounded-tr-sm border border-line-8 bg-raised px-4 py-3 @min-[624px]/conversation:max-w-[576px]',
              pendingNote && 'opacity-60',
            )}
          >
            <MentionChips mentions={item.mentions} className="flex min-w-0 flex-wrap items-center gap-1.5" />
            <AttachmentList attachments={attachments} className="justify-end" />
            <div
              ref={bodyRef}
              hidden={!text}
              className={cn('overflow-hidden', collapsed && 'agent-prompt-clamp')}
              style={collapsed ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
            >
              <p className="m-0 whitespace-pre-wrap break-words text-bubble leading-6 text-fg select-text">{text}</p>
            </div>
            {overflows ? (
              <div className={cn('flex justify-center', collapsed && '-mt-5')}>
                <Button
                  size="sm"
                  variant="outline"
                  trailingIcon={expanded ? ChevronUp : ChevronDown}
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                  className="rounded-chip bg-content"
                >
                  {expanded ? t('agent.message.collapse') : t('agent.message.expand')}
                </Button>
              </div>
            ) : null}
          </div>
          {pendingNote ? (
            <span className="mt-1 flex min-h-6 max-w-full items-center gap-1 text-caption text-fg-3">
              <Clock size={12} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{pendingNote}</span>
            </span>
          ) : null}
          <div
            hidden={Boolean(pendingNote)}
            className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100"
          >
            {canEdit ? (
              <Tooltip content={t('common.edit')}>
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label={t('common.edit')}
                  onClick={startEdit}
                  className="text-fg-3"
                />
              </Tooltip>
            ) : null}
            {onResend ? (
              <Tooltip content={t('agent.message.resend')}>
                <IconButton
                  size="sm"
                  icon={RefreshCw}
                  label={t('agent.message.resend')}
                  onClick={resendPrompt}
                  className="text-fg-3"
                />
              </Tooltip>
            ) : null}
            <CopyAction text={text} />
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
