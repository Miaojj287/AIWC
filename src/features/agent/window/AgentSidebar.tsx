/**
 * Agent window sidebar (CLAUDE.md §12, laid out like ZCode's): quiet 32px navigation rows — 新会话 (⌘N), the search
 * field (⌘K), 定时任务 (switches the list below to the 定时任务 object list and back) — then the grouped single-line
 * thread rows (status in the leading slot, time on the right, hover ···, right-click — the same menu as the panel via
 * threadMenus), and the account row → 设置 with 记忆与规则 beside it at the bottom. Selection is a neutral ground, never
 * the accent: the sidebar sits beside the conversation and stays quiet.
 */
import { Brain, CalendarClock, CircleAlert, Ellipsis, Plus, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadSummary } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { shortcutLabel } from '@/app/shortcuts'
import { useT, type MessageKey } from '@/i18n'
import {
  Avatar,
  Chip,
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
  type IconComponent,
  ListItem,
  ScrollArea,
  SearchBox,
  SkeletonListRows,
  Spinner,
  Tooltip,
} from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatTime } from '@/platform/format'
import { listKeyNav } from '@/platform/listNavigation'
import { toMediaUrl } from '@/platform/mediaUrl'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { ListHeaderContext, type ListHeaderApi } from '@/shell/objectList/listHeaderContext'
import { selectActiveObjectId } from '@/shell/objectList/ObjectList'
import { getObjectList } from '@/shell/objectListRegistry'
import { useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { isUntitledTitle } from '../model'
import { threadRowMenu } from '../threadMenus'
import { ThreadAttentionMark, ThreadQuestionMark } from '../ThreadAttentionMark'
import type { AgentSurface } from '../useAgentSurface'
import { useAgentWindowStore, type SidebarView } from './agentWindowStore'
import { contentOnlyHits, useThreadSearch } from '../threadSearch'
import { SidebarArchived } from './SidebarArchived'
import { SidebarContentHits, SidebarLoadMore } from './SidebarSearchHits'
import { filterThreads, groupThreads, type ThreadGroupId } from './threadGroups'

export interface AgentSidebarProps {
  surface: AgentSurface
  mac: boolean
}

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
  const tasksOpen = view === 'tasks'
  const setView = (next: SidebarView) => useAgentWindowStore.getState().setSidebarView(next)

  return (
    <nav
      aria-label={t('agent.window.sidebar.label')}
      className="flex h-full min-h-0 flex-col"
      data-testid="agent-sidebar"
    >
      <div className="flex shrink-0 flex-col gap-px px-2 pb-2 pt-3">
        <ListItem
          compact
          leading={<NavIcon icon={Plus} />}
          title={t('agent.window.sidebar.newThread')}
          meta={newKbd}
          onSelect={() => runCommand('agent.newThread', {})}
          data-testid="agent-sidebar-new"
        />
        <ListItem
          compact
          leading={<NavIcon icon={CalendarClock} active={tasksOpen} />}
          title={t('agent.window.sidebar.views.tasks')}
          selected={tasksOpen}
          aria-pressed={tasksOpen}
          onSelect={() => setView(tasksOpen ? 'threads' : 'tasks')}
          data-testid="agent-sidebar-tasks"
        />
        <SearchBox
          ref={searchRef}
          value={query}
          onValueChange={(value) => useAgentWindowStore.getState().setQuery(value)}
          placeholder={searchLabel}
          shortcut={mac ? '⌘K' : 'Ctrl+K'}
          aria-label={searchLabel}
          landmark
          // A quiet filled field, not a bordered box: it reads as one more row of the sidebar until it has focus.
          wrapperClassName="mt-1.5 h-8 min-w-0 rounded-item border-transparent bg-hover-5 hover:border-transparent"
        />
      </div>
      <div className="min-h-0 flex-1">
        {/* Keyed by view: a crashed list does not leave its error behind when switching. */}
        <ErrorBoundary key={view} compact>
          {view === 'threads' ? <ThreadRows surface={surface} query={query} /> : <TaskRows query={query} />}
        </ErrorBoundary>
      </div>
      <AccountTile />
    </nav>
  )
}

/** 16px navigation glyph: secondary text colour, full foreground while its row is the open view. */
function NavIcon({ icon: Icon, active = false }: { icon: IconComponent; active?: boolean }) {
  return <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden className={active ? 'text-fg' : 'text-fg-2'} />
}

/* ------------------------------------------------------------------ threads */

function ThreadRows({ surface, query }: { surface: AgentSurface; query: string }) {
  const t = useT()
  const { threads, hydrating, loadError, store } = surface
  const untitled = t('agent.thread.untitled')
  const filtered = useMemo(() => filterThreads(threads, query, untitled), [threads, query, untitled])
  const groups = useMemo(() => groupThreads(filtered), [filtered])
  const search = useThreadSearch(query)
  const contentHits = useMemo(() => contentOnlyHits(search.hits, filtered), [search.hits, filtered])
  // Loading and failure are not "no chats yet": say which one it is, and offer the retry the conversation column has.
  if (threads.length === 0 && hydrating) return <SkeletonListRows rows={6} avatar={false} className="px-4 pt-3" />
  if (threads.length === 0 && loadError)
    return (
      <EmptyState
        compact
        variant="error"
        title={t('agent.panel.threadsLoadFailed')}
        action={{ label: t('common.retry'), onClick: () => void store().hydrate() }}
        className="h-full"
      />
    )
  if (threads.length === 0)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EmptyState
          compact
          variant="empty"
          title={t('agent.window.sidebar.empty')}
          description={t('agent.window.sidebar.emptyHint')}
          className="min-h-0 flex-1"
        />
        <div className="shrink-0 px-2 pb-1">
          <SidebarArchived surface={surface} query={query} />
        </div>
      </div>
    )
  if (filtered.length === 0 && contentHits.length === 0)
    return search.loading ? (
      <EmptyState compact variant="loading" title={t('agent.history.searching')} className="h-full" />
    ) : (
      <EmptyState
        compact
        variant={search.error ? 'error' : 'no-results'}
        title={
          search.error ? t('agent.history.searchFailed', { detail: search.error }) : t('agent.window.sidebar.noResults')
        }
        description={search.active && !search.error ? t('agent.history.searchLocal') : undefined}
        className="h-full"
      />
    )
  return (
    <ScrollArea className="h-full">
      <div
        role="list"
        aria-label={t('agent.window.sidebar.list')}
        className="flex flex-col px-2 pb-2"
        onKeyDown={listKeyNav}
      >
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-px pb-2" data-group={group.id}>
            <h2 className="m-0 px-2.5 pb-1 pt-2 text-caption font-medium text-fg-3">{t(GROUP_LABEL[group.id])}</h2>
            {group.threads.map((thread) => (
              <ThreadRow key={thread.threadId} thread={thread} surface={surface} />
            ))}
          </section>
        ))}
        {search.active ? <SidebarContentHits hits={contentHits} loading={search.loading} /> : <SidebarLoadMore />}
        <SidebarArchived surface={surface} query={query} />
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
  else if (view?.pendingQuestions?.length) status = <ThreadQuestionMark />
  else if (view?.isStreaming) status = <Spinner size={12} label={t('agent.window.sidebar.streaming')} />
  else status = <ThreadAttentionMark threadId={id} />
  // One line per thread, like ZCode: the status mark sits in the leading slot, the right edge says when (or that the
  // draft was never sent); the context object stays in the row's tooltip and in the header chip of the open thread.
  const meta = saved ? formatTime(thread.updatedAt) : t('agent.window.sidebar.draft')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          compact
          selected={selected}
          onSelect={() => store().setActive(id)}
          leading={status}
          title={title}
          meta={meta}
          tooltip={thread.contextRef ? t('agent.window.header.context', { label: thread.contextRef.label }) : undefined}
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
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 px-3 pb-1.5">
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

/**
 * Bottom row (ZCode's footer): the current account → 设置 (like the rail avatar), with
 * 记忆与规则 → 设置 › 记忆 as a quiet icon button beside it. No rule above it: the list's own end is separation enough.
 */
function AccountTile() {
  const t = useT()
  const wxid = useConfig((c) => c.account.wxid)
  const { data: status } = useAccountStatus()
  const account = status?.account
  const name = account?.nickname?.trim() || account?.wxid || wxid || ''
  const settingsActive = useTabsStore((s) => s.activeId === 'settings:settings')
  return (
    <div className="flex shrink-0 items-center gap-0.5 px-2 pb-3 pt-2">
      <ListItem
        dense
        quiet
        selected={settingsActive}
        onSelect={() => runCommand('tab.openSettings', {})}
        aria-label={name ? t('agent.window.sidebar.accountSettings', { name }) : t('agent.window.sidebar.settings')}
        leading={
          name ? (
            <Avatar id={account?.wxid ?? wxid ?? ''} name={name} src={toMediaUrl(account?.avatarPath)} size={28} />
          ) : (
            <UserRound size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-2" />
          )
        }
        title={name || t('agent.window.sidebar.settings')}
        className="min-h-10 min-w-0 flex-1 gap-2 px-1.5 py-1"
        data-testid="agent-sidebar-account"
      />
      <Tooltip content={t('agent.window.sidebar.memory')}>
        <IconButton
          icon={Brain}
          label={t('agent.window.sidebar.memory')}
          onClick={() => runCommand('tab.openSettings', { page: 'memory' })}
          className="text-fg-2"
        />
      </Tooltip>
    </div>
  )
}
