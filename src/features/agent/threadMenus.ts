/**
 * Thread menus shared by every Agent surface — the panel's tab strip and history popover, the Agent
 * window's sidebar rows and header (CLAUDE.md §12: both surfaces expose the same actions). Item order
 * follows CLAUDE.md §4.2: regular actions → separator → context actions → separator → close → danger last.
 */
import { Download, Layers, MessageSquare, Pencil, Pin, PinOff, RotateCcw, Trash } from 'lucide-react'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import type { Translator } from '@/i18n'
import type { MenuSpec } from '@/kit'

export type ThreadAction = 'rename' | 'export' | 'compact' | 'clear' | 'delete'

export interface ThreadMenuHandlers {
  onAction: (action: ThreadAction, id: ThreadId) => void
  onPin: (id: ThreadId, pinned: boolean) => void
}

/**
 * `···` menu of the active thread: rename / pin → export / compact / clear → delete.
 * `saved` = the thread has kernel history (a local draft can only be renamed or deleted).
 */
export function activeThreadMenu(
  t: Translator,
  active: ThreadSummary | undefined,
  saved: boolean,
  handlers: ThreadMenuHandlers,
): MenuSpec {
  const id = active?.threadId
  const off = !id
  const run = (action: ThreadAction) => () => id && handlers.onAction(action, id)
  return [
    { id: 'rename', label: t('agent.thread.renameThread'), icon: Pencil, disabled: off, onSelect: run('rename') },
    {
      id: 'pin',
      label: active?.pinned ? t('agent.thread.unpin') : t('agent.thread.pin'),
      icon: active?.pinned ? PinOff : Pin,
      disabled: off || !saved,
      onSelect: () => id && handlers.onPin(id, !active?.pinned),
    },
    { type: 'separator' },
    { id: 'export', label: t('agent.thread.export'), icon: Download, disabled: off || !saved, onSelect: run('export') },
    {
      id: 'compact',
      label: t('agent.context.compact'),
      icon: Layers,
      description: t('agent.context.compactDescription'),
      disabled: off || !saved,
      onSelect: run('compact'),
    },
    {
      id: 'clear',
      label: t('agent.thread.clearContext'),
      icon: RotateCcw,
      disabled: off || !saved,
      onSelect: run('clear'),
    },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('agent.thread.delete'),
      icon: Trash,
      danger: true,
      disabled: off,
      onSelect: run('delete'),
    },
  ]
}

export interface ThreadRowMenuOptions extends ThreadMenuHandlers {
  thread: ThreadSummary
  /** Has kernel history: pin / export / compact / clear need it. */
  saved: boolean
  /** 打开会话 as the first item (rows other than the active thread). */
  onOpen?: () => void
  /** Add 压缩上下文 / 清空上下文 (Agent window rows; the panel keeps them in the active-thread menu only). */
  context?: boolean
  /** Close-tab items for a thread that is open in the panel strip. */
  close?: {
    onClose: () => void
    onCloseOthers: () => void
    canCloseOthers: boolean
    labels: { close: string; closeOthers: string }
  }
}

/** Right-click / `···` menu of one thread row (tab, history row, sidebar row). */
export function threadRowMenu(t: Translator, o: ThreadRowMenuOptions): MenuSpec {
  const { thread } = o
  const id = thread.threadId
  const items: MenuSpec = []
  if (o.onOpen) items.push({ id: 'open', label: t('agent.thread.open'), icon: MessageSquare, onSelect: o.onOpen })
  items.push(
    { id: 'rename', label: t('agent.thread.rename'), icon: Pencil, onSelect: () => o.onAction('rename', id) },
    {
      id: 'pin',
      label: thread.pinned ? t('agent.thread.unpin') : t('agent.thread.pin'),
      icon: thread.pinned ? PinOff : Pin,
      disabled: !o.saved,
      onSelect: () => o.onPin(id, !thread.pinned),
    },
    { type: 'separator' },
    {
      id: 'export',
      label: t('agent.thread.export'),
      icon: Download,
      disabled: !o.saved,
      onSelect: () => o.onAction('export', id),
    },
  )
  if (o.context) {
    items.push(
      {
        id: 'compact',
        label: t('agent.context.compact'),
        icon: Layers,
        description: t('agent.context.compactDescription'),
        disabled: !o.saved,
        onSelect: () => o.onAction('compact', id),
      },
      {
        id: 'clear',
        label: t('agent.thread.clearContext'),
        icon: RotateCcw,
        disabled: !o.saved,
        onSelect: () => o.onAction('clear', id),
      },
    )
  }
  if (o.close) {
    items.push(
      { type: 'separator' },
      { id: 'close', label: o.close.labels.close, onSelect: o.close.onClose },
      {
        id: 'closeOthers',
        label: o.close.labels.closeOthers,
        disabled: !o.close.canCloseOthers,
        onSelect: o.close.onCloseOthers,
      },
    )
  }
  items.push(
    { type: 'separator' },
    {
      id: 'delete',
      label: t('agent.thread.delete'),
      icon: Trash,
      danger: true,
      onSelect: () => o.onAction('delete', id),
    },
  )
  return items
}
