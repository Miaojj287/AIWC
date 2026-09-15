/**
 * Agent window sidebar (CLAUDE.md §12): 新会话, the search box (⌘K), a segmented switch between the thread
 * list and the 定时任务 object list, the grouped thread rows (hover ···, right-click, running / awaiting-approval
 * status — the same menu as the panel via threadMenus), and the account tile → 设置 at the bottom.
 */
import { Brain, CircleAlert, Ellipsis, MessageSquare, Plus, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { shortcutLabel } from '@/app/shortcuts'
import { useT, type MessageKey } from '@/i18n'
import {
  Avatar,
  Button,
  Chip,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ErrorBoundary,
  ICON_STROKE,
  IconButton,
  Kbd,
  ListItem,
  ScrollArea,
  SearchBox,
  SegmentedControl,
  Spinner,
  Tooltip,
} from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatTime } from '@/platform/format'
import { toMediaUrl } from '@/platform/mediaUrl'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { ListHeaderContext, type ListHeaderApi } from '@/shell/objectList/listHeaderContext'
import { selectActiveObjectId } from '@/shell/objectList/ObjectList'
import { getObjectList } from '@/shell/objectListRegistry'
import { useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { isUntitledTitle } from '../model'
import { threadRowMenu } from '../threadMenus'
import type { AgentSurface } from '../useAgentSurface'
import { useAgentWindowStore, type SidebarView } from './agentWindowStore'
import { filterThreads, groupThreads, type ThreadGroupId } from './threadGroups'

export interface AgentSidebarProps {
  surface: AgentSurface
  mac: boolean
}

const VIEW_OPTIONS: ReadonlyArray<{ value: SidebarView; labelKey: MessageKey }> = [
  { value: 'threads', labelKey: 'agent.window.sidebar.views.threads' },
  { value: 'tasks', labelKey: 'agent.window.sidebar.views.tasks' },
]

const GROUP_LABEL: Record<ThreadGroupId, MessageKey> = {
  pinned: 'agent.window.sidebar.groups.pinned',
  today: 'agent.window.sidebar.groups.today',
  yesterday: 'agent.window.sidebar.groups.yesterday',
  week: 'agent.window.sidebar.groups.week',
  earlier: 'agent.window.sidebar.groups.earlier',
}

export function AgentSidebar({ surface, mac }: AgentSidebarProps) {
  const t = useT()
  const view = useAgentWindowStore((s) => s.sidebarView)
  const query = useAgentWindowStore((s) => s.query)
  const focusRequest = useAgentWindowStore((s) => s.searchFocusRequest)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusRequest === 0) return
    const el = searchRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusRequest])
  const searchLabel =
    view === 'threads' ? t('agent.window.sidebar.searchThreads') : t('agent.window.sidebar.searchTasks')
  const newKbd = shortcutLabel('agent.newThread', mac)

  return (
    <nav
      aria-label={t('agent.window.sidebar.label')}
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-sidebar"
    >
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-3">
        <Button
          variant="outline"
          icon={Plus}
          className="w-full justify-start"
          onClick={() => runCommand('agent.newThread', {})}
          data-testid="agent-sidebar-new"
        >
          <span className="min-w-0 flex-1 truncate text-left">{t('agent.window.sidebar.newThread')}</span>
          {newKbd ? <Kbd keys={newKbd} className="ml-auto" /> : null}
        </Button>
        <SearchBox
          ref={searchRef}
          value={query}
          onValueChange={(value) => useAgentWindowStore.getState().setQuery(value)}
          placeholder={searchLabel}
          shortcut={mac ? '⌘K' : 'Ctrl+K'}
          aria-label={searchLabel}
          wrapperClassName="h-8 min-w-0 rounded-item"
        />
        <SegmentedControl
          size="sm"
          fullWidth
          aria-label={t('agent.window.sidebar.label')}
          options={VIEW_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          value={view}
          onValueChange={(next) => useAgentWindowStore.getState().setSidebarView(next)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {/* Keyed by view: a crashed list does not leave its error behind when switching. */}
        <ErrorBoundary key={view} compact>
          {view === 'threads' ? <ThreadRows surface={surface} query={query} /> : <TaskRows query={query} />}
        </ErrorBoundary>
      </div>
      <AccountTile mac={mac} />
    </nav>
  )
}

/* ------------------------------------------------------------------ threads */

function ThreadRows({ surface, query }: { surface: AgentSurface; query: string }) {
  const t = useT()
  const { threads } = surface
  const untitled = t('agent.thread.untitled')
  const filtered = useMemo(() => filterThreads(threads, query, untitled), [threads, query, untitled])
  const groups = useMemo(() => groupThreads(filtered), [filtered])
  if (threads.length === 0)
    return (
      <EmptyState
        compact
        variant="empty"
        title={t('agent.window.sidebar.empty')}
        description={t('agent.window.sidebar.emptyHint')}
        className="h-full"
      />
    )
  if (filtered.length === 0)
    return <EmptyState compact variant="no-results" title={t('agent.window.sidebar.noResults')} className="h-full" />
  return (
    <ScrollArea className="h-full">
      <div role="list" aria-label={t('agent.window.sidebar.list')} className="flex flex-col px-2 py-1">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-px pb-1.5" data-group={group.id}>
            <h2 className="m-0 px-2.5 pb-1 pt-2 text-micro font-medium text-fg-3">{t(GROUP_LABEL[group.id])}</h2>
            {group.threads.map((thread) => (
              <ThreadRow key={thread.threadId} thread={thread} surface={surface} />
            ))}
          </section>
        ))}
      </div>
    </ScrollArea>
  )
}

function ThreadRow({ thread, surface }: { thread: ThreadSummary; surface: AgentSurface }) {
  const t = useT()
  const { localIds, openIds, activeThreadId, views, store, onAction } = surface
  const id = thread.threadId
  const selected = id === activeThreadId
  const saved = !localIds.includes(id)
  const isOpen = openIds.includes(id)
  const view = views[id]
  const title = isUntitledTitle(thread.title) ? t('agent.thread.untitled') : thread.title
  const menu = useMemo(
    () =>
      threadRowMenu(t, {
        thread,
        saved,
        context: true,
        onOpen: selected ? undefined : () => store().setActive(id),
        onAction,
        onPin: (threadId, pinned) => void store().pin(threadId, pinned),
        close: isOpen
          ? {
              onClose: () => store().closeThread(id),
              onCloseOthers: () => store().closeOtherThreads(id),
              canCloseOthers: openIds.length > 1,
              labels: {
                close: t('agent.window.sidebar.closeTab'),
                closeOthers: t('agent.window.sidebar.closeOthers'),
              },
            }
          : undefined,
      }),
    [id, isOpen, onAction, openIds.length, saved, selected, store, t, thread],
  )
  let status: ReactNode = null
  if (view?.pendingApprovals.length)
    status = (
      <Tooltip content={t('agent.window.sidebar.awaitingApproval')}>
        <CircleAlert
          size={14}
          strokeWidth={ICON_STROKE}
          aria-label={t('agent.window.sidebar.awaitingApproval')}
          className="text-warn"
        />
      </Tooltip>
    )
  else if (view?.isStreaming) status = <Spinner size={12} label={t('agent.window.sidebar.streaming')} />
  const subtitle = !saved ? t('agent.window.sidebar.draft') : (thread.contextRef?.label ?? t('agent.history.noContext'))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          dense
          selected={selected}
          onSelect={() => store().setActive(id)}
          leading={
            <MessageSquare
              size={15}
              strokeWidth={ICON_STROKE}
              aria-hidden
              className={cn(selected ? 'text-accent' : 'text-fg-3')}
            />
          }
          title={title}
          subtitle={subtitle}
          meta={formatTime(thread.updatedAt)}
          trailing={status}
          hoverActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('agent.window.sidebar.moreActions', { title })} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
          data-thread-id={id}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* -------------------------------------------------------------------- tasks */

/**
 * The 定时任务 object list, hosted the way the four-column ObjectList hosts it: the registered body plus its
 * segment chips (counts come back through ListHeaderContext). Rows open the task editor in the workspace pane.
 */
function TaskRows({ query }: { query: string }) {
  const t = useT()
  const registration = getObjectList('tasks')
  const segment = useShellStore((s) => s.listSegment)
  const activeObjectId = useTabsStore((s) => selectActiveObjectId(s.tabs, s.activeId, s.lastActiveByFunction, 'tasks'))
  const [counts, setCounts] = useState<Record<string, number>>({})
  const api = useMemo<ListHeaderApi>(() => ({ setCounts, setFilterOptions: () => undefined }), [])
  if (!registration) return <EmptyState compact title={t('shell.objectList.noList')} className="h-full" />
  const Body = registration.component
  const segments = registration.segments ?? []
  const first = segments[0]?.id
  const current = segment ?? first ?? null
  return (
    <div className="flex h-full min-h-0 flex-col">
      {segments.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1 px-3 pb-1.5">
          {segments.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              count={counts[s.id]}
              selected={current === s.id}
              onClick={() => useShellStore.getState().setListSegment(s.id === first ? null : s.id)}
            />
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ListHeaderContext.Provider value={api}>
          <Body query={query} activeObjectId={activeObjectId} />
        </ListHeaderContext.Provider>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ account */

/** Bottom tile: the current account → 设置 (like the rail avatar), plus 记忆与规则 → 设置 › 记忆. */
function AccountTile({ mac }: { mac: boolean }) {
  const t = useT()
  const wxid = useConfig((c) => c.account.wxid)
  const { data: status } = useAccountStatus()
  const account = status?.account
  const name = account?.nickname?.trim() || account?.wxid || wxid || ''
  const settingsActive = useTabsStore((s) => s.activeId === 'settings:settings')
  return (
    <div className="shrink-0 border-t border-line-6 px-2 py-1.5">
      <ListItem
        dense
        selected={settingsActive}
        onSelect={() => runCommand('tab.openSettings', {})}
        aria-label={name ? t('agent.window.sidebar.accountSettings', { name }) : t('agent.window.sidebar.settings')}
        leading={
          name ? (
            <Avatar id={account?.wxid ?? wxid ?? ''} name={name} src={toMediaUrl(account?.avatarPath)} size={36} />
          ) : (
            <UserRound size={18} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-2" />
          )
        }
        title={name || t('agent.window.sidebar.settings')}
        subtitle={
          <span className="flex items-center gap-1">
            <span className="min-w-0 truncate">{t('agent.window.sidebar.settings')}</span>
            {shortcutLabel('tab.openSettings', mac) ? (
              <Kbd keys={shortcutLabel('tab.openSettings', mac) ?? ''} />
            ) : null}
          </span>
        }
        trailing={
          <Tooltip content={t('agent.window.sidebar.memory')}>
            <IconButton
              size="sm"
              icon={Brain}
              label={t('agent.window.sidebar.memory')}
              onClick={(e) => {
                e.stopPropagation()
                runCommand('tab.openSettings', { page: 'memory' })
              }}
            />
          </Tooltip>
        }
        data-testid="agent-sidebar-account"
      />
    </div>
  )
}
