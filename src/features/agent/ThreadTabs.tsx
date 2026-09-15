/**
 * Thread tab strip of the Agent panel (Figma 150:424): one kit Tab per open thread (hover ×, right-click
 * menu), ＋ new thread, history popover, ··· thread menu, and the collapse button. Dialogs live in
 * ThreadDialogs — this component only reports actions. History rows are kit menu items (h42 with
 * description) inside a Popover, since the list also carries a SearchBox.
 */
import { ArrowUpRight, Ellipsis, History, MessageSquare, PanelRightClose, Pin, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { shortcutLabel } from '@/app/shortcuts'
import { useT } from '@/i18n'
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  Divider,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ICON_SIZE,
  ICON_STROKE,
  IconButton,
  menuItemClass,
  MenuItemContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchBox,
  Tab,
  Tooltip,
} from '@/kit'
import { formatTime } from '@/platform/format'
import { isUntitledTitle } from './model'
import { activeThreadMenu, threadRowMenu, type ThreadAction } from './threadMenus'

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
  /** 「Agent 窗口」 pill: switch the window to the full-window Agent layout (CLAUDE.md §12). */
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
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
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
    <div
      role="tablist"
      aria-label={t('agent.tabs.label')}
      className="flex h-10 shrink-0 items-center bg-shell pr-1.5"
      data-testid="agent-thread-tabs"
    >
      <div
        ref={stripRef}
        className="flex h-full min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              onClose: () => onClose(thread.threadId),
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
                  onClose={() => onClose(thread.threadId)}
                  className="max-w-[160px]"
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menu} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
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
          <Button
            variant="outline"
            size="sm"
            trailingIcon={ArrowUpRight}
            onClick={onOpenWindow}
            className="ml-1"
            data-testid="agent-open-window"
          >
            {t('agent.window.open')}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

const RECENT_LIMIT = 5

/** Kit menu item (h42 with description) used outside a Radix menu: hover / focus stand in for data-highlighted. */
const HISTORY_ROW_CLASS = cn(menuItemClass({ description: true }), 'hover:bg-hover-7 focus-visible:bg-hover-7')

interface HistoryPopoverProps {
  all: ThreadSummary[]
  activeId: ThreadId | null
  onSelect: (id: ThreadId) => void
  onPin: (id: ThreadId, pinned: boolean) => void
  onAction: (action: ThreadAction, id: ThreadId) => void
}

function HistoryPopover({ all, activeId, onSelect, onPin, onAction }: HistoryPopoverProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? all.filter((t) => t.title.toLowerCase().includes(q) || t.contextRef?.label.toLowerCase().includes(q))
      : all
  }, [all, query])
  const rows = showAll || query ? filtered : filtered.slice(0, RECENT_LIMIT)
  const pick = (id: ThreadId) => {
    onSelect(id)
    setOpen(false)
    setQuery('')
    setShowAll(false)
  }
  /** Close first: the rename / delete dialogs are modal and must not open under this popover. */
  function run(action: ThreadAction, id: ThreadId): void
  function run(fn: () => void): void
  function run(a: ThreadAction | (() => void), id?: ThreadId): void {
    setOpen(false)
    setQuery('')
    setShowAll(false)
    if (typeof a === 'function') a()
    else if (id) onAction(a, id)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setQuery('')
          setShowAll(false)
        }
      }}
    >
      <Tooltip content={t('agent.history.label')}>
        <PopoverTrigger asChild>
          <IconButton size="sm" icon={History} label={t('agent.history.label')} active={open} />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[280px] p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-micro font-medium text-fg-3">
          {showAll ? t('agent.history.all') : t('agent.history.recent')}
        </div>
        <SearchBox
          size="sm"
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t('agent.history.searchPlaceholder')}
          aria-label={t('agent.history.search')}
          wrapperClassName="mx-0.5"
        />
        <div
          role="listbox"
          aria-label={t('agent.history.list')}
          className="mt-1 flex max-h-[300px] flex-col gap-px overflow-y-auto"
        >
          {rows.length === 0 ? (
            <EmptyState
              variant={all.length === 0 ? 'empty' : 'no-results'}
              title={all.length === 0 ? t('agent.history.empty') : t('agent.history.noResults')}
              compact
              className="py-4"
            />
          ) : (
            rows.map((thread) => {
              const selected = thread.threadId === activeId
              const title = isUntitledTitle(thread.title) ? t('agent.thread.untitled') : thread.title
              // Every history row is saved; actions close the popover first (see `run`).
              const menu = threadRowMenu(t, {
                thread,
                saved: true,
                onOpen: () => pick(thread.threadId),
                onAction: (action, id) => run(action, id),
                onPin: (id, pinned) => run(() => onPin(id, pinned)),
              })
              return (
                <ContextMenu key={thread.threadId}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => pick(thread.threadId)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          pick(thread.threadId)
                        }
                      }}
                      className={cn(
                        HISTORY_ROW_CLASS,
                        'group',
                        selected && 'bg-accent-12 hover:bg-accent-12 focus-visible:bg-accent-12 [&>svg]:text-accent',
                      )}
                    >
                      <MenuItemContent
                        icon={MessageSquare}
                        label={title}
                        description={`${formatTime(thread.updatedAt)} · ${thread.contextRef?.label ?? t('agent.history.noContext')}`}
                        badge={
                          <span className="flex items-center gap-1">
                            {thread.pinned ? (
                              <Pin
                                size={ICON_SIZE.menuAux}
                                strokeWidth={ICON_STROKE}
                                aria-hidden
                                className="text-fg-3"
                              />
                            ) : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  size="sm"
                                  icon={Ellipsis}
                                  label={t('agent.history.moreActions', { title })}
                                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItems items={menu} />
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </span>
                        }
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItems items={menu} />
                  </ContextMenuContent>
                </ContextMenu>
              )
            })
          )}
        </div>
        {!query && all.length > RECENT_LIMIT ? (
          <>
            <Divider strength={8} className="my-1" />
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')}
            >
              <MenuItemContent
                icon={History}
                label={showAll ? t('agent.history.showRecent') : t('agent.history.showAll', { n: all.length })}
              />
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
