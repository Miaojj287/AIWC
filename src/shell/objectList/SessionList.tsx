import { ChevronDown, ChevronRight, Folder, Ellipsis, Pin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VList, type VListHandle } from 'virtua'
import type { WxSession } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { detectMac } from '@/app/shortcuts'
import {
  Avatar,
  Badge,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  ListItem,
  SkeletonListRows,
  toast,
  ICON_STROKE,
} from '@/kit'
import { formatCount, formatTime } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import type { ObjectListProps } from '@/shell/objectListRegistry'
import { useShellStore } from '@/shell/shellStore'
import { useListCounts, useListFilterOptions } from './listHeaderContext'
import {
  applyClientFilters,
  buildSessionRows,
  type SessionFolder,
  segmentKind,
  servableAvatar,
  sessionMenuSpec,
  sessionSubtitle,
  SESSION_FILTER_OPTIONS,
  SESSION_PAGE_SIZE,
} from './sessionListModel'

interface ListState {
  items: WxSession[]
  total: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error?: Error
}

const INITIAL: ListState = { items: [], total: 0, hasMore: false, loading: true, loadingMore: false }

/**
 * SessionList — the chat function's left column (DESIGN-SPEC §1.1). Paged substrate:listSessions in a
 * virtual list; segments 全部 / 单聊 / 群聊 with live counts; 更多筛选 = 仅未读 / 已静音 / 已隐藏; selection
 * follows the active chat tab; click opens the chat tab; `···` and right-click share one menu.
 */
export function SessionList({ query, activeObjectId }: ObjectListProps) {
  const segment = useShellStore((s) => s.listSegment)
  const filters = useShellStore((s) => s.listFilters)
  const kind = segmentKind(segment)
  const unreadOnly = Boolean(filters.unreadOnly)
  const includeHidden = Boolean(filters.hidden)
  const mac = detectMac()

  useListFilterOptions(SESSION_FILTER_OPTIONS)

  const [state, setState] = useState<ListState>(INITIAL)
  const stateRef = useRef(state)
  stateRef.current = state
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const requestSeq = useRef(0)

  const baseQuery = useMemo(() => ({ query: query.trim() || undefined, unreadOnly: unreadOnly || undefined, includeHidden: includeHidden || undefined }), [query, unreadOnly, includeHidden])

  // Match CipherTalk: paint the first page immediately and fetch further pages on scroll.
  useEffect(() => {
    const seq = ++requestSeq.current
    setState((current) => ({ ...current, loading: current.items.length === 0, loadingMore: false, error: undefined }))
    invoke('substrate:listSessions', { ...baseQuery, kind, offset: 0, limit: SESSION_PAGE_SIZE })
      .then((res) => {
        if (seq !== requestSeq.current) return
        setState({ items: res.items, total: res.total, hasMore: res.hasMore, loading: false, loadingMore: false })
      })
      .catch((e: unknown) => {
        if (seq !== requestSeq.current) return
        setState((s) => ({ ...s, loading: false, loadingMore: false, error: e instanceof Error ? e : new Error(String(e)) }))
      })
    return () => { requestSeq.current++ }
  }, [baseQuery, kind, tick])

  const loadMore = useCallback(() => {
    const current = stateRef.current
    if (!current.hasMore || current.loading || current.loadingMore) return
    const seq = requestSeq.current
    setState((s) => ({ ...s, loadingMore: true }))
    invoke('substrate:listSessions', { ...baseQuery, kind, offset: current.items.length, limit: SESSION_PAGE_SIZE })
      .then((res) => {
        if (seq !== requestSeq.current) return
        setState((s) => ({
          ...s,
          items: dedupe([...s.items, ...res.items]),
          total: res.total,
          hasMore: res.hasMore,
          loadingMore: false,
        }))
      })
      .catch(() => setState((s) => ({ ...s, loadingMore: false })))
  }, [baseQuery, kind])

  useBridgeEvent('substrate:event', (e) => {
    if (e.type === 'connection') {
      setState({ ...INITIAL })
      reload()
    } else if (e.type === 'sessions.changed') reload()
  })

  // live segment counts (respect search + extra filters, not the selected segment)
  const countReq = { ...baseQuery, limit: 1 }
  const all = useInvoke('substrate:listSessions', { ...countReq, kind: 'all' }, [baseQuery, tick])
  const dm = useInvoke('substrate:listSessions', { ...countReq, kind: 'dm' }, [baseQuery, tick])
  const group = useInvoke('substrate:listSessions', { ...countReq, kind: 'group' }, [baseQuery, tick])
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    if (all.data) out.all = all.data.total
    if (dm.data) out.dm = dm.data.total
    if (group.data) out.group = group.data.total
    return Object.keys(out).length ? out : undefined
  }, [all.data, dm.data, group.data])
  useListCounts(counts)

  const [expanded, setExpanded] = useState<ReadonlySet<SessionFolder>>(() => new Set(['pinned']))
  const toggleFolder = (folder: SessionFolder) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    return next
  })
  useEffect(() => {
    const active = state.items.find((s) => s.id === activeObjectId)
    if (!active) return
    const folder = active.kind === 'official' || active.id.startsWith('gh_') ? 'official' : active.collapsed ? 'collapsed' : active.pinned ? 'pinned' : undefined
    if (folder) setExpanded((prev) => prev.has(folder) ? prev : new Set([...prev, folder]))
  }, [activeObjectId, state.items])
  const visible = useMemo(() => buildSessionRows(applyClientFilters(state.items, filters), expanded, Boolean(query.trim())), [state.items, filters, expanded, query])

  // keep the selected session in view when the active tab changes
  const listRef = useRef<VListHandle>(null)
  useEffect(() => {
    if (!activeObjectId) return
    const idx = visible.findIndex((s) => s.id === activeObjectId)
    if (idx >= 0) listRef.current?.scrollToIndex(idx, { align: 'nearest' })
  }, [activeObjectId, visible])

  const onScroll = useCallback(() => {
    const list = listRef.current
    if (list && list.scrollOffset + list.viewportSize >= list.scrollSize - 240) loadMore()
  }, [loadMore])

  // A folded first page can be shorter than the viewport and therefore cannot produce a scroll
  // event. Continue a page at a time until the list can scroll or the source is exhausted.
  useEffect(() => {
    if (state.hasMore && visible.length < 12) loadMore()
  }, [state.hasMore, visible.length, loadMore])

  const setFlags = useCallback(
    async (sessionId: string, flags: { pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }) => {
      try {
        await invoke('substrate:setSessionFlags', { sessionId, ...flags })
        reload()
      } catch (e) {
        toast.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [reload],
  )

  const filtered = Boolean(query.trim()) || unreadOnly || Boolean(filters.mutedOnly) || kind !== 'all'

  if (state.error?.message.includes('尚未连接微信数据')) {
    return <EmptyState compact title="尚未连接微信" description="连接本机微信数据库后，这里会显示真实会话。" action={{ label: '连接微信', onClick: () => runCommand('tab.openSettings', { page: 'account' }) }} className="h-full" />
  }
  if (state.error && state.items.length === 0) {
    return <EmptyState compact variant="error" title="会话加载失败" description={state.error.message} action={{ label: '重试', onClick: reload }} className="h-full" />
  }
  if (state.loading && state.items.length === 0) {
    return <SkeletonListRows rows={8} className="px-4 pt-2" />
  }
  if (visible.length === 0) {
    return filtered || includeHidden ? (
      <EmptyState
        compact
        variant="no-results"
        title="没有匹配的会话"
        description={query.trim() ? `没有会话名包含「${query.trim()}」` : '试试放宽筛选条件'}
        action={{ label: '清除筛选', onClick: () => useShellStore.getState().clearListFilters() }}
        secondaryAction={query.trim() ? { label: '清空搜索', onClick: () => useShellStore.getState().setListQuery('') } : undefined}
        className="h-full"
      />
    ) : (
      <EmptyState
        compact
        title="还没有会话"
        description="完成一次同步后，这里会列出本机微信的所有会话。数据只在本地读取，不会上传。"
        action={{ label: '立即同步', onClick: () => void invoke('substrate:sync', {}).then(reload) }}
        className="h-full"
      />
    )
  }

  return (
    <VList ref={listRef} data={visible} onScroll={onScroll} onScrollEnd={onScroll} className="h-full px-2 pb-2 pt-0.5" style={{ height: '100%' }} aria-label="会话列表">
      {(session) => session.folder ? (
        <ListItem key={session.id} data-session-folder={session.folder} aria-expanded={expanded.has(session.folder)}
          leading={<span className="flex size-9 items-center justify-center rounded-item bg-raised text-fg-2"><Folder size={20} /></span>}
          title={`${session.title}（${session.count}）`} subtitle={session.lastPreview}
          meta={formatTime(session.lastMessageAt)}
          trailing={<span className="flex items-center gap-1">{session.unread > 0 ? <Badge tone="accent">{formatCount(session.unread)}</Badge> : null}{expanded.has(session.folder) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
          onSelect={() => toggleFolder(session.folder!)} />
      ) : (
        <div key={session.id} className={session.child ? 'pl-4' : undefined}><SessionRow
          key={session.id}
          session={session}
          selected={session.id === activeObjectId}
          mac={mac}
          hiddenView={includeHidden}
          onFlags={(flags) => void setFlags(session.id, flags)}
        /></div>
      )}
    </VList>
  )
}

interface SessionRowProps {
  session: WxSession
  selected: boolean
  mac: boolean
  hiddenView: boolean
  onFlags(flags: { pinned?: boolean; muted?: boolean; hidden?: boolean; read?: boolean }): void
}

function SessionRow({ session, selected, mac, hiddenView, onFlags }: SessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const open = () => runCommand('tab.openChat', { sessionId: session.id, title: session.title })
  const menu = sessionMenuSpec(
    session,
    {
      setFlags: onFlags,
      openAutoReply: () => runCommand('tab.openAutoReply', { sessionId: session.id, title: session.title }),
      openClone: () => runCommand('tab.openClone', { contactId: session.id, title: session.title }),
      quoteToAgent: () => runCommand('agent.quote', { kind: 'session', id: session.id, label: session.title }),
      hide: () => {
        onFlags({ hidden: true })
        toast.success(`已从列表隐藏「${session.title}」`, { action: { label: '撤销', onClick: () => onFlags({ hidden: false }) } })
      },
      unhide: () => onFlags({ hidden: false }),
    },
    { mac, hidden: hiddenView },
  )
  const subtitle = sessionSubtitle(session)
  const trailing =
    session.unread > 0 ? (
      session.muted ? (
        <Badge dot tone="neutral" aria-label={`${session.unread} 条未读（已静音）`} />
      ) : (
        <Badge tone="accent" aria-label={`${session.unread} 条未读`} className="border-transparent bg-accent font-latin text-(--fg-on-accent)">
          {formatCount(session.unread)}
        </Badge>
      )
    ) : null

  return (
    <div className="py-px">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ListItem
            data-hover={menuOpen || undefined}
            data-session-id={session.id}
            leading={
              <Avatar id={session.id} name={session.title} size={36} src={servableAvatar(session.avatarPath)} />
            }
            title={session.title}
            subtitle={subtitle || undefined}
            meta={
              <span className="inline-flex items-center gap-1">
                {session.pinned ? <Pin size={11} strokeWidth={ICON_STROKE} aria-label="已置顶" className="text-fg-3" /> : null}
                {formatTime(session.lastMessageAt)}
              </span>
            }
            trailing={trailing}
            selected={selected}
            onSelect={open}
            hoverActions={
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={Ellipsis} label={`${session.title} 的更多操作`} size="sm" className="bg-panel/80" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
    </div>
  )
}

function dedupe(items: WxSession[]): WxSession[] {
  const seen = new Set<string>()
  return items.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}
