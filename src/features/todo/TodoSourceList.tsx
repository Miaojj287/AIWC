/**
 * ObjectList body for the 每日待办 rail function: a 全部待办 row that opens the dashboard, then the group
 * chats — the ones being scanned first — each with a Toggle that adds it to / removes it from the scan
 * (config `todo.sources`). Selecting a chat opens the dashboard narrowed to it. Groups are paged and
 * searched on the backend like the chat list; scanned groups are always complete.
 */
import { Ellipsis, ListTodo, MessageSquare, Minus, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { VList, type VListHandle } from 'virtua'
import { TODO_MAX_SOURCES, type TodoSource, type WxSession } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT, type MessageKey } from '@/i18n'
import {
  Avatar,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ICON_STROKE,
  IconButton,
  ListItem,
  SkeletonListRows,
  Toggle,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatTime } from '@/platform/format'
import { useBridgeEvent } from '@/platform/hooks'
import { listKeyNav } from '@/platform/listNavigation'
import { toMediaUrl } from '@/platform/mediaUrl'
import { usePagedSessions, useSessionsById } from '@/platform/sessionPaging'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { useListCounts } from '@/shell/objectList/listHeaderContext'
import { useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
import { openCountBySource } from './todoModel'
import { canAddSource, setSourcePicked } from './todoSources'
import { scanTodos, useTodos } from './todoStore'

export type SourceSegment = 'all' | 'picked'

export const SOURCE_SEGMENTS: ReadonlyArray<{ id: SourceSegment; labelKey: MessageKey }> = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'picked', labelKey: 'todo.list.segments.picked' },
]

/** The dashboard is one tab; its `sourceId` state is the chat it is narrowed to. */
export const TODO_TAB_ID = 'todo:todo'

const LOAD_MORE_THRESHOLD_PX = 240
const MIN_FILLED_ROWS = 30
const OVERVIEW = 'overview' as const
const FOOTER = 'footer' as const

interface SourceRow {
  id: string
  title: string
  session?: WxSession
  picked: boolean
}

type Row = SourceRow | typeof OVERVIEW | typeof FOOTER

const matches = (title: string, query: string) => title.toLowerCase().includes(query.trim().toLowerCase())

export function TodoSourceList({ query, activeObjectId }: ObjectListProps) {
  const t = useT()
  const todo = useConfig((c) => c.todo)
  const sources = useMemo(() => todo?.sources ?? [], [todo?.sources])
  const { items } = useTodos()
  const segmentId = useShellStore((s) => s.listSegment)
  const setSegment = useShellStore((s) => s.setListSegment)
  const segment: SourceSegment = SOURCE_SEGMENTS.some((s) => s.id === segmentId) ? (segmentId as SourceSegment) : 'all'
  const filter = useTabsStore((s) => {
    const value = s.tabs.find((tab) => tab.id === TODO_TAB_ID)?.state?.sourceId
    return typeof value === 'string' ? value : undefined
  })
  const page = usePagedSessions(query, segment === 'all', 'group')
  const { hasMore, loadMore, reload } = page
  const pickedIds = useMemo(() => sources.map((s) => s.id), [sources])
  const picked = useSessionsById(pickedIds, 0, todo !== undefined)
  const listRef = useRef<VListHandle>(null)
  const openCounts = useMemo(() => openCountBySource(items), [items])
  const openTotal = useMemo(() => items.filter((i) => !i.done).length, [items])

  useBridgeEvent('substrate:event', (e) => {
    if (e.type === 'sessions.changed' || (e.type === 'connection' && e.state === 'ready')) reload()
  })

  const rows = useMemo<SourceRow[]>(() => {
    const pickedRows = sources
      .map((s) => {
        const session = picked.sessions.get(s.id)
        return { id: s.id, title: session?.title || s.title || s.id, picked: true, ...(session ? { session } : {}) }
      })
      .filter((r) => matches(r.title, query))
    if (segment === 'picked') return pickedRows
    const ids = new Set(pickedIds)
    const rest = page.items
      .filter((s) => s.kind === 'group' && !ids.has(s.id))
      .map((session) => ({ id: session.id, title: session.title || session.id, session, picked: false }))
    return [...pickedRows, ...rest]
  }, [sources, picked.sessions, query, segment, pickedIds, page.items])

  const counts = useMemo(() => ({ picked: sources.length }), [sources.length])
  useListCounts(counts)

  const loadMoreNearEnd = useCallback(() => {
    if (segment !== 'all' || !hasMore) return
    const list = listRef.current
    if (list && list.scrollOffset + list.viewportSize >= list.scrollSize - LOAD_MORE_THRESHOLD_PX) loadMore()
  }, [segment, hasMore, loadMore])
  useEffect(() => {
    if (segment === 'all' && hasMore && rows.length < MIN_FILLED_ROWS) loadMore()
    else loadMoreNearEnd()
  }, [segment, hasMore, rows.length, loadMore, loadMoreNearEnd])

  const full = !canAddSource(sources)
  const menuFor = (row: SourceRow): MenuSpec => {
    const chat: TodoSource = { id: row.id, title: row.title }
    const menu: MenuSpec = [
      {
        id: 'view',
        label: t('todo.list.menu.view'),
        icon: ListTodo,
        onSelect: () => runCommand('tab.openTodo', { sourceId: row.id }),
      },
    ]
    if (row.picked)
      menu.push({
        id: 'scan',
        label: t('todo.list.menu.scanNow'),
        icon: RefreshCw,
        disabled: !todo?.enabled,
        onSelect: () => void scanTodos([row.id]),
      })
    menu.push(
      { type: 'separator' },
      {
        id: 'chat',
        label: t('todo.list.menu.openChat'),
        icon: MessageSquare,
        onSelect: () => runCommand('tab.openChat', { sessionId: row.id, title: row.title }),
      },
      { type: 'separator' },
      row.picked
        ? {
            id: 'unpick',
            label: t('todo.list.menu.unpick'),
            icon: Minus,
            onSelect: () => void setSourcePicked(chat, false),
          }
        : {
            id: 'pick',
            label: t('todo.list.menu.pick'),
            icon: Plus,
            disabled: full,
            onSelect: () => void setSourcePicked(chat, true),
          },
    )
    return menu
  }

  const loading = !todo || picked.loading || (segment === 'all' && page.loading && rows.length === 0)
  if (loading) return <SkeletonListRows rows={6} className="px-5 pt-2" />
  const loadError = picked.error ?? (rows.length === 0 ? page.error : undefined)
  if (loadError)
    return (
      <EmptyState
        compact
        variant="error"
        title={t('todo.list.loadFailed')}
        description={loadError.message}
        action={{ label: t('common.retry'), onClick: reload }}
      />
    )

  const showFooter = segment === 'all' && (page.loadingMore || Boolean(page.error))
  const data: Row[] = [OVERVIEW, ...rows, ...(showFooter ? [FOOTER] : [])]
  const overviewSelected = activeObjectId === 'todo' && filter === undefined

  return (
    <div className="h-full" onKeyDown={listKeyNav}>
      <VList
        ref={listRef}
        data={data}
        onScroll={loadMoreNearEnd}
        onScrollEnd={loadMoreNearEnd}
        role="group"
        aria-label={t('todo.list.ariaLabel')}
        className="h-full overscroll-contain px-2 py-1.5"
        style={{ height: '100%' }}
      >
        {(row) => {
          if (row === OVERVIEW)
            return (
              <div key={OVERVIEW} className="flex flex-col gap-1">
                <ListItem
                  leading={
                    <span className="flex size-9 items-center justify-center rounded-item bg-hover-7 text-fg-2">
                      <ListTodo size={18} strokeWidth={ICON_STROKE} aria-hidden />
                    </span>
                  }
                  title={t('todo.list.overview')}
                  subtitle={openTotal > 0 ? t('todo.list.openCount', { n: openTotal }) : t('todo.list.overviewEmpty')}
                  selected={overviewSelected}
                  onSelect={() => runCommand('tab.openTodo', {})}
                />
                {rows.length === 0 ? (
                  segment === 'picked' && !query.trim() ? (
                    <EmptyState
                      compact
                      title={t('todo.list.noneTitle')}
                      description={t('todo.list.noneDescription')}
                      action={{ label: t('todo.list.viewAll'), onClick: () => setSegment(null) }}
                    />
                  ) : page.loadingMore || (segment === 'all' && hasMore) ? (
                    <SkeletonListRows rows={3} className="px-0.5" />
                  ) : (
                    <EmptyState
                      compact
                      variant="no-results"
                      title={query.trim() ? t('todo.list.noMatch', { query }) : t('todo.list.noGroups')}
                    />
                  )
                ) : (
                  <div className="px-2.5 pb-0.5 pt-2 text-micro font-medium text-fg-3">
                    {t('todo.list.groupsHeading', { n: sources.length, max: TODO_MAX_SOURCES })}
                  </div>
                )}
              </div>
            )
          if (row === FOOTER)
            return (
              <div key={FOOTER} className="py-1">
                {page.error ? (
                  <EmptyState
                    compact
                    variant="error"
                    title={t('todo.list.loadFailed')}
                    description={page.error.message}
                    action={{ label: t('common.retry'), onClick: reload }}
                  />
                ) : (
                  <SkeletonListRows rows={2} className="px-0.5" />
                )}
              </div>
            )
          return (
            <SourceListRow
              key={row.id}
              row={row}
              open={openCounts.get(row.id) ?? 0}
              selected={activeObjectId === 'todo' && filter === row.id}
              full={full}
              menu={menuFor(row)}
            />
          )
        }}
      </VList>
    </div>
  )
}

interface SourceListRowProps {
  row: SourceRow
  /** Open todos from this chat. */
  open: number
  selected: boolean
  /** The scan already has TODO_MAX_SOURCES chats: turning another one on is refused. */
  full: boolean
  menu: MenuSpec
}

function SourceListRow({ row, open, selected, full, menu }: SourceListRowProps) {
  const t = useT()
  const chat: TodoSource = { id: row.id, title: row.title }
  const subtitle = row.picked
    ? open > 0
      ? t('todo.list.openCount', { n: open })
      : t('todo.list.scanned')
    : row.session?.lastPreview || t('todo.list.notScanned')
  const blocked = !row.picked && full
  const toggle = (
    <Toggle
      label={t('todo.list.toggleLabel', { name: row.title })}
      checked={row.picked}
      disabled={blocked}
      onCheckedChange={(on) => void setSourcePicked(chat, on)}
      onClick={(e) => e.stopPropagation()}
    />
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListItem
          leading={<Avatar id={row.id} name={row.title} src={toMediaUrl(row.session?.avatarPath)} />}
          title={row.title}
          subtitle={
            <span className={row.picked && open > 0 ? 'truncate text-accent-ink' : 'truncate'} title={subtitle}>
              {subtitle}
            </span>
          }
          meta={row.picked ? undefined : formatTime(row.session?.lastMessageAt)}
          selected={selected}
          onSelect={() => runCommand('tab.openTodo', { sourceId: row.id })}
          trailing={
            blocked ? (
              <Tooltip content={t('todo.sources.limit', { max: TODO_MAX_SOURCES })}>
                <span>{toggle}</span>
              </Tooltip>
            ) : (
              toggle
            )
          }
          hoverActions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Ellipsis} label={t('todo.list.moreActions', { name: row.title })} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItems items={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
