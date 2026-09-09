import { ListFilter, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SyncStatus } from '@aiwc/protocol'
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchBox,
  Tooltip,
  toast,
  type MenuSpec,
} from '@/kit'
import { formatClock } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { getObjectList } from '@/shell/objectListRegistry'
import { hasActiveListFilters, useShellStore } from '@/shell/shellStore'
import { TAB_FUNCTION, useTabsStore, type RailFunction } from '@/workspace/tabsStore'
import { ListHeaderContext, type ListFilterOption, type ListHeaderApi } from './listHeaderContext'

export interface ObjectListProps {
  mac: boolean
}

/** The column is a singleton; remember which ⌘K request has already been honoured across remounts. */
let handledFocusRequest = 0

interface HeaderState {
  fn: RailFunction
  counts: Record<string, number>
  filterOptions: readonly ListFilterOption[]
}

/**
 * ObjectList — the 280px column (Figma 115:429): sticky header = SearchBox (⌘K) + refresh; a chip row
 * with live counts + 更多筛选 + 清除筛选; the body is whatever the current rail function registered
 * (DESIGN-SPEC §0.2). Empty / loading / error states inside the body come from the body itself; the
 * frame only covers "no list registered for this function".
 */
export function ObjectList({ mac }: ObjectListProps) {
  const fn = useShellStore((s) => s.railFunction)
  const query = useShellStore((s) => s.listQuery)
  const segment = useShellStore((s) => s.listSegment)
  const filters = useShellStore((s) => s.listFilters)
  const focusRequest = useShellStore((s) => s.searchFocusRequest)
  const registration = getObjectList(fn)
  const activeObjectId = useTabsStore((s) => selectActiveObjectId(s.tabs, s.activeId, s.lastActiveByFunction, fn))

  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusRequest === 0 || focusRequest === handledFocusRequest) return
    handledFocusRequest = focusRequest
    const el = searchRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusRequest])

  // header state pushed up by the body; reset synchronously when the function changes (the new body's
  // mount effects run before any parent effect, so an effect-based reset would wipe its first counts)
  const [header, setHeader] = useState<HeaderState>({ fn, counts: {}, filterOptions: [] })
  if (header.fn !== fn) setHeader({ fn, counts: {}, filterOptions: [] })
  const { counts, filterOptions }: Pick<HeaderState, 'counts' | 'filterOptions'> = header.fn === fn ? header : { counts: {}, filterOptions: [] }
  const headerApi = useMemo<ListHeaderApi>(
    () => ({
      setCounts: (next) => setHeader((prev) => (shallowEqual(prev.counts, next) ? prev : { ...prev, counts: next })),
      setFilterOptions: (next) => setHeader((prev) => (prev.filterOptions === next ? prev : { ...prev, filterOptions: next })),
    }),
    [],
  )

  const segments = registration?.segments ?? []
  const firstSegment = segments[0]?.id
  const currentSegment = segment ?? firstSegment ?? null
  const filtersActive = hasActiveListFilters({ listSegment: segment, listFilters: filters }, firstSegment)
  const extraActive = Object.keys(filters).length > 0

  const filterMenu = useMemo<MenuSpec>(() => {
    const shell = useShellStore.getState()
    const items: MenuSpec = [{ type: 'label', id: 'title', label: `筛选${registration?.title ?? ''}` }]
    for (const opt of filterOptions) {
      items.push({
        type: 'checkbox',
        id: opt.id,
        label: opt.label,
        description: opt.description,
        checked: Boolean(filters[opt.id]),
        onCheckedChange: (on) => shell.setListFilter(opt.id, on),
      })
    }
    items.push({ type: 'separator' }, { id: 'clear', label: '清除筛选', icon: X, disabled: !filtersActive, onSelect: () => shell.clearListFilters() })
    return items
  }, [filterOptions, filters, filtersActive, registration?.title])

  const Body = registration?.component

  return (
    <aside aria-label={registration?.title ?? '对象列表'} className="flex h-full w-full min-w-0 flex-col border-r border-line-6 bg-panel">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <SearchBox
          ref={searchRef}
          value={query}
          onValueChange={(v) => useShellStore.getState().setListQuery(v)}
          placeholder={`搜索${registration?.title ?? ''}`}
          shortcut={mac ? '⌘K' : 'Ctrl+K'}
          aria-label={`搜索${registration?.title ?? ''}`}
          wrapperClassName="h-8 min-w-0 flex-1 rounded-item"
        />
        <RefreshButton />
      </div>
      {segments.length > 0 || filterOptions.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-0.5">
          {segments.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              count={counts[s.id]}
              selected={currentSegment === s.id}
              onClick={() => useShellStore.getState().setListSegment(s.id === firstSegment ? null : s.id)}
            />
          ))}
          <span className="flex-1" />
          {filtersActive ? (
            <Button variant="link" size="sm" icon={X} onClick={() => useShellStore.getState().clearListFilters()} className="h-6 px-1.5">
              清除筛选
            </Button>
          ) : null}
          {filterOptions.length > 0 ? (
            <DropdownMenu>
              <Tooltip content="更多筛选">
                <DropdownMenuTrigger asChild>
                  <IconButton icon={ListFilter} label="更多筛选" size="sm" active={extraActive} />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                <DropdownMenuItems items={filterMenu} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ListHeaderContext.Provider value={headerApi}>
          {Body ? (
            <Body key={fn} query={query} activeObjectId={activeObjectId} />
          ) : (
            <EmptyState compact title="此功能暂无列表" description="对应功能尚未注册对象列表。" className="h-full" />
          )}
        </ListHeaderContext.Provider>
      </div>
    </aside>
  )
}

/** Selection = the object behind the active tab when it belongs to this function, else the function's last tab. */
export function selectActiveObjectId(
  tabs: ReadonlyArray<{ id: string; kind: keyof typeof TAB_FUNCTION; objectId: string }>,
  activeId: string | null,
  lastActiveByFunction: Partial<Record<RailFunction, string>>,
  fn: RailFunction,
): string | null {
  const active = activeId ? tabs.find((t) => t.id === activeId) : undefined
  if (active && TAB_FUNCTION[active.kind] === fn) return active.objectId
  const lastId = lastActiveByFunction[fn]
  const last = lastId ? tabs.find((t) => t.id === lastId) : undefined
  return last?.objectId ?? null
}

/**
 * Refresh = one incremental sync (DESIGN-SPEC §1.1). Spins while the substrate reports `syncing`;
 * the tooltip shows the last sync time. Also answers the `search.sessions` command by focusing the search.
 */
function RefreshButton() {
  const { data: status, reload } = useInvoke('substrate:status', undefined, [])
  const [sync, setSync] = useState<SyncStatus | undefined>(undefined)
  useEffect(() => {
    if (status?.sync) setSync(status.sync)
  }, [status])
  useBridgeEvent('substrate:event', (e) => {
    if (e.type === 'sync') setSync(e.status)
    else if (e.type === 'connection') reload()
  })
  // Local pending flag: the `syncing` phase only arrives with the first substrate event, so without
  // it the button stays clickable for a moment and a double click starts two syncs (交互准则 2 / 3).
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const syncing = sync?.phase === 'syncing' || pending
  const onRefresh = useCallback(async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await invoke('substrate:sync', {})
      setSync(result)
      if (result.phase === 'error' && result.error) toast.error('同步失败', { detail: result.error, action: { label: '重试', onClick: () => void onRefresh() } })
      else if (result.phase === 'idle') toast.success('同步完成')
    } catch (e) {
      toast.error('同步失败', { detail: e instanceof Error ? e.message : String(e), action: { label: '重试', onClick: () => void onRefresh() } })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [])

  const tip = syncing
    ? sync?.progress
      ? `正在同步… ${sync.progress.done} / ${sync.progress.total}`
      : '正在同步…'
    : sync?.lastSyncedAt
      ? `上次同步 ${formatClock(sync.lastSyncedAt)} · 点击增量同步`
      : '尚未同步 · 点击开始'
  return (
    <Tooltip content={tip}>
      <IconButton
        icon={RefreshCw}
        label="刷新"
        loading={syncing}
        onClick={() => void onRefresh()}
        className="size-8 rounded-item border border-line-8 bg-content text-fg-2 hover:bg-content hover:text-fg"
      />
    </Tooltip>
  )
}

function shallowEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k] === b[k])
}
