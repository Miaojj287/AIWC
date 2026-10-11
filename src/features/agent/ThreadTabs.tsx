/**
 * Thread tab strip of the Agent panel (Figma 150:424): one kit Tab per open thread (hover ×, right-click
 * menu), ＋ new thread, history popover, ··· thread menu, the collapse button and the Agent-window switch.
 * Dialogs live in ThreadDialogs — this component only reports actions. History rows are kit menu items
 * (h42 with description) inside a Popover, since the list also carries a SearchBox.
 *
 * Only the inner strip is the `tablist`: a tablist may hold nothing but tabs, and the buttons on the right
 * are ordinary toolbar controls. Closing a tab here hands focus to the tab that became active.
 */
import { ArrowUpRight, Ellipsis, MessageSquare, PanelRightClose, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { shortcutLabel } from '@/app/shortcuts'
import { useT } from '@/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  Tab,
  Tooltip,
} from '@/kit'
import { isUntitledTitle } from './model'
import { HistoryPopover } from './HistoryPopover'
import { activeThreadMenu, threadRowMenu, type ThreadAction } from './threadMenus'
import { attentionIndicator, useThreadAttention } from './threadAttention'

export interface ThreadTabsProps {
  /** Open threads, in strip order. */
  open: ThreadSummary[]
  /** Every desktop thread (history popover). */
  all: ThreadSummary[]
  activeId: ThreadId | null
  mac: boolean
  onSelect: (id: ThreadId) => void
  onClose: (id: ThreadId) => void
  onCloseOthers: (id: ThreadId) => void
  onNew: () => void
  onPin: (id: ThreadId, pinned: boolean) => void
  onAction: (action: ThreadAction, id: ThreadId) => void
  onToggleCollapsed: () => void
  /** 「Agent 窗口」 switch: the full-window Agent layout (CLAUDE.md §12). An icon here; the 360px strip has no room for a text pill. */
  onOpenWindow: () => void
}

export function ThreadTabs({
  open,
  all,
  activeId,
  mac,
  onSelect,
  onClose,
  onCloseOthers,
  onNew,
  onPin,
  onAction,
  onToggleCollapsed,
  onOpenWindow,
}: ThreadTabsProps) {
  const t = useT()
  const marks = useThreadAttention((s) => s.marks)
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  // Closing a tab from the strip (× or Delete / Backspace on it) unmounts the focused element. Focus would fall
  // to <body>, so it moves to the tab that became active once that render has committed.
  const [closedTab, setClosedTab] = useState<{ id: ThreadId } | undefined>(undefined)
  const closeTab = (id: ThreadId): void => {
    setClosedTab({ id })
    onClose(id)
  }
  useEffect(() => {
    if (!closedTab) return
    stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [closedTab])
  const active = activeId ? open.find((t) => t.threadId === activeId) : undefined
  const threadMenu = useMemo(
    () =>
      activeThreadMenu(
        t,
        active,
        all.some((thread) => thread.threadId === active?.threadId),
        { onAction, onPin },
      ),
    [active, all, onAction, onPin, t],
  )

  return (
    // The strip is window chrome: its empty stretch drags the window, the tabs and buttons opt out.
    <div className="app-drag flex h-10 shrink-0 items-center bg-shell pr-1.5" data-testid="agent-thread-tabs">
      <div
        ref={stripRef}
        role="tablist"
        aria-label={t('agent.tabs.label')}
        className="scrollbar-none flex h-full min-w-0 flex-1 items-end overflow-x-auto"
      >
        {open.map((thread) => {
          const unsaved = !all.some((saved) => saved.threadId === thread.threadId)
          const isActive = thread.threadId === activeId
          const menu = threadRowMenu(t, {
            thread,
            saved: !unsaved,
            onAction,
            onPin,
            close: {
              onClose: () => closeTab(thread.threadId),
              onCloseOthers: () => onCloseOthers(thread.threadId),
              canCloseOthers: open.length > 1,
              labels: { close: t('common.close'), closeOthers: t('agent.tabs.closeOthers') },
            },
          })
          return (
            <ContextMenu key={thread.threadId}>
              <ContextMenuTrigger asChild>
                <Tab
                  icon={MessageSquare}
                  label={isUntitledTitle(thread.title) ? t('agent.thread.untitled') : thread.title}
                  active={isActive}
                  pinned={thread.pinned}
                  activeBg="panel"
                  onSelect={() => onSelect(thread.threadId)}
                  onClose={() => closeTab(thread.threadId)}
                  indicator={attentionIndicator(marks[thread.threadId], t)}
                  className="app-no-drag max-w-[160px]"
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menu} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-0.5 pl-1">
        <Tooltip content={t('agent.thread.new')} kbd={shortcutLabel('agent.newThread', mac)}>
          <IconButton size="sm" icon={Plus} label={t('agent.thread.new')} onClick={onNew} />
        </Tooltip>
        <HistoryPopover all={all} activeId={activeId} onSelect={onSelect} onPin={onPin} onAction={onAction} />
        <DropdownMenu>
          <Tooltip content={t('agent.tabs.menu')}>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" icon={Ellipsis} label={t('agent.tabs.menu')} />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent className="min-w-[228px]">
            <DropdownMenuItems items={threadMenu} />
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content={t('agent.panel.collapse')} kbd={shortcutLabel('agent.toggleCollapsed', mac)}>
          <IconButton size="sm" icon={PanelRightClose} label={t('agent.panel.collapse')} onClick={onToggleCollapsed} />
        </Tooltip>
        {/* Entry to the Agent window (CLAUDE.md §12) — the rightmost control, like the IDE's own layout switch. */}
        <Tooltip content={t('agent.window.openTip')} kbd={shortcutLabel('shell.toggleMode', mac)}>
          <IconButton
            size="sm"
            icon={ArrowUpRight}
            label={t('agent.window.open')}
            onClick={onOpenWindow}
            data-testid="agent-open-window"
          />
        </Tooltip>
      </div>
    </div>
  )
}
