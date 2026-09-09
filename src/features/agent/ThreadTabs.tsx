/**
 * Thread tab strip of the Agent panel (Figma 150:424): one kit Tab per open thread (hover ×, right-click
 * menu), ＋ new thread, history popover, ··· thread menu, and the collapse button. Dialogs live in
 * ThreadDialogs — this component only reports actions. History rows are kit menu items (h42 with
 * description) inside a Popover, since the list also carries a SearchBox.
 */
import { Download, Ellipsis, History, Layers, MessageSquare, PanelRightClose, Pencil, Pin, PinOff, Plus, RotateCcw, Trash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreadId, ThreadSummary } from '@aiwc/protocol'
import { shortcutLabel } from '@/app/shortcuts'
import {
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchBox,
  Tab,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { MenuItemContent } from '@/kit/menu/MenuItemBody'
import { menuItemClass } from '@/kit/menu/menuStyles'
import { formatTime } from '@/platform/format'

export type ThreadAction = 'rename' | 'export' | 'compact' | 'clear' | 'delete'

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
}

export function ThreadTabs({ open, all, activeId, mac, onSelect, onClose, onCloseOthers, onNew, onPin, onAction, onToggleCollapsed }: ThreadTabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  const active = activeId ? open.find((t) => t.threadId === activeId) : undefined
  const threadMenu: MenuSpec = useMemo(() => {
    const id = active?.threadId
    const off = !id
    const unsaved = !all.some((t) => t.threadId === id)
    const run = (action: ThreadAction) => () => id && onAction(action, id)
    return [
      { id: 'rename', label: '重命名会话', icon: Pencil, disabled: off, onSelect: run('rename') },
      { id: 'pin', label: active?.pinned ? '取消固定' : '固定会话', icon: active?.pinned ? PinOff : Pin, disabled: off || unsaved, onSelect: () => id && onPin(id, !active?.pinned) },
      { type: 'separator' },
      { id: 'export', label: '导出对话', icon: Download, disabled: off || unsaved, onSelect: run('export') },
      { id: 'compact', label: '压缩上下文', icon: Layers, description: '保留结论与引用，释放大部分上下文', disabled: off || unsaved, onSelect: run('compact') },
      { id: 'clear', label: '清空上下文', icon: RotateCcw, disabled: off || unsaved, onSelect: run('clear') },
      { type: 'separator' },
      { id: 'delete', label: '删除会话', icon: Trash, danger: true, disabled: off, onSelect: run('delete') },
    ]
  }, [active, all, onAction, onPin])

  return (
    <div role="tablist" aria-label="Agent 会话" className="flex h-10 shrink-0 items-center bg-shell pr-1.5" data-testid="agent-thread-tabs">
      <div ref={stripRef} className="flex h-full min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {open.map((t) => {
          const unsaved = !all.some((saved) => saved.threadId === t.threadId)
          const isActive = t.threadId === activeId
          const menu: MenuSpec = [
            { id: 'rename', label: '重命名', icon: Pencil, onSelect: () => onAction('rename', t.threadId) },
            { id: 'pin', label: t.pinned ? '取消固定' : '固定会话', icon: t.pinned ? PinOff : Pin, disabled: unsaved, onSelect: () => onPin(t.threadId, !t.pinned) },
            { type: 'separator' },
            { id: 'export', label: '导出对话', icon: Download, disabled: unsaved, onSelect: () => onAction('export', t.threadId) },
            { type: 'separator' },
            { id: 'close', label: '关闭', onSelect: () => onClose(t.threadId) },
            { id: 'closeOthers', label: '关闭其他', disabled: open.length <= 1, onSelect: () => onCloseOthers(t.threadId) },
            { type: 'separator' },
            { id: 'delete', label: '删除会话', icon: Trash, danger: true, onSelect: () => onAction('delete', t.threadId) },
          ]
          return (
            <ContextMenu key={t.threadId}>
              <ContextMenuTrigger asChild>
                <Tab icon={MessageSquare} label={t.title || '新会话'} active={isActive} pinned={t.pinned} activeBg="panel" onSelect={() => onSelect(t.threadId)} onClose={() => onClose(t.threadId)} className="max-w-[160px]" />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menu} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        <Tooltip content="新建会话" kbd={shortcutLabel('agent.newThread', mac)}>
          <IconButton size="sm" icon={Plus} label="新建会话" onClick={onNew} />
        </Tooltip>
        <HistoryPopover all={all} activeId={activeId} onSelect={onSelect} onPin={onPin} onAction={onAction} />
        <DropdownMenu>
          <Tooltip content="会话菜单">
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" icon={Ellipsis} label="会话菜单" />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent className="min-w-[228px]">
            <DropdownMenuItems items={threadMenu} />
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip content="收起 Agent 面板" kbd={shortcutLabel('agent.toggleCollapsed', mac)}>
          <IconButton size="sm" icon={PanelRightClose} label="收起 Agent 面板" onClick={onToggleCollapsed} />
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter((t) => t.title.toLowerCase().includes(q) || t.contextRef?.label.toLowerCase().includes(q)) : all
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
      <Tooltip content="历史会话">
        <PopoverTrigger asChild>
          <IconButton size="sm" icon={History} label="历史会话" active={open} />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[280px] p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-micro font-medium text-fg-3">{showAll ? '全部会话' : '最近会话'}</div>
        <SearchBox size="sm" autoFocus value={query} onValueChange={setQuery} placeholder="搜索会话…" aria-label="搜索会话" wrapperClassName="mx-0.5" />
        <div role="listbox" aria-label="会话" className="mt-1 flex max-h-[300px] flex-col gap-px overflow-y-auto">
          {rows.length === 0 ? (
            <EmptyState variant={all.length === 0 ? 'empty' : 'no-results'} title={all.length === 0 ? '还没有会话' : '没有匹配的会话'} compact className="py-4" />
          ) : (
            rows.map((t) => {
              const selected = t.threadId === activeId
              const menu: MenuSpec = [
                { id: 'open', label: '打开会话', icon: MessageSquare, onSelect: () => pick(t.threadId) },
                { id: 'rename', label: '重命名', icon: Pencil, onSelect: () => run('rename', t.threadId) },
                { id: 'pin', label: t.pinned ? '取消固定' : '固定会话', icon: t.pinned ? PinOff : Pin, onSelect: () => run(() => onPin(t.threadId, !t.pinned)) },
                { type: 'separator' },
                { id: 'export', label: '导出对话', icon: Download, onSelect: () => run('export', t.threadId) },
                { type: 'separator' },
                { id: 'delete', label: '删除会话', icon: Trash, danger: true, onSelect: () => run('delete', t.threadId) },
              ]
              return (
                <ContextMenu key={t.threadId}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => pick(t.threadId)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          pick(t.threadId)
                        }
                      }}
                      className={cn(HISTORY_ROW_CLASS, 'group', selected && 'bg-accent-12 hover:bg-accent-12 focus-visible:bg-accent-12 [&>svg]:text-accent')}
                    >
                      <MenuItemContent
                        icon={MessageSquare}
                        label={t.title || '新会话'}
                        description={`${formatTime(t.updatedAt)} · ${t.contextRef?.label ?? '无引用'}`}
                        badge={
                          <span className="flex items-center gap-1">
                            {t.pinned ? <Pin size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" /> : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  size="sm"
                                  icon={Ellipsis}
                                  label={`${t.title || '新会话'} 的更多操作`}
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
            <button type="button" onClick={() => setShowAll((v) => !v)} className={cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')}>
              <MenuItemContent icon={History} label={showAll ? '只看最近' : `查看全部 ${all.length} 个会话`} />
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
