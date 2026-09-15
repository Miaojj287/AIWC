import { ListFilter, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SyncStatus } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  cn,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  ErrorBoundary,
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

/** Square 32px tool next to the list search (更多筛选, 刷新); `shell-list-tool` lets 透明效果 make it translucent. */
const HEADER_TOOL_CLASS =
  'shell-list-tool size-8 rounded-item border border-line-8 bg-content text-fg-2 hover:bg-content hover:text-fg'

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
 * frame only covers "no list registered for this function" and a body that throws while rendering.
 */
export function ObjectList({ mac }: ObjectListProps) {
  const t = useT()
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
  const { counts, filterOptions }: Pick<HeaderState, 'counts' | 'filterOptions'> =
    header.fn === fn ? header : { counts: {}, filterOptions: [] }
  const headerApi = useMemo<ListHeaderApi>(
    () => ({
      setCounts: (next) => setHeader((prev) => (shallowEqual(prev.counts, next) ? prev : { ...prev, counts: next })),
      setFilterOptions: (next) =>
        setHeader((prev) => (prev.filterOptions === next ? prev : { ...prev, filterOptions: next })),
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
    const items: MenuSpec = [
      { type: 'label', id: 'title', label: t('shell.objectList.filterTitle', { title: registration?.title ?? '' }) },
    ]
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
    items.push(
      { type: 'separator' },
      {
        id: 'clear',
        label: t('shell.objectList.clearFilters'),
        icon: X,
        disabled: !filtersActive,
        onSelect: () => shell.clearListFilters(),
      },
    )
    return items
  }, [filterOptions, filters, filtersActive, registration?.title, t])

  const Body = registration?.component

  return (
    <aside
      aria-label={registration?.title ?? t('shell.objectList.ariaLabel')}
      className="shell-list @container/list flex h-full w-full min-w-0 flex-col border-r border-line-6 bg-panel"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <SearchBox
          ref={searchRef}
          value={query}
          onValueChange={(v) => useShellStore.getState().setListQuery(v)}
          placeholder={t('shell.objectList.search', { title: registration?.title ?? '' })}
          shortcut={mac ? '⌘K' : 'Ctrl+K'}
          aria-label={t('shell.objectList.search', { title: registration?.title ?? '' })}
          wrapperClassName="h-8 min-w-0 flex-1 rounded-item"
        />
        {/* 更多筛选 sits with the other header tools: three counted chips plus two icons do not fit one 280px row. */}
        {filterOptions.length > 0 ? (
          <DropdownMenu>
            <Tooltip content={t('shell.objectList.moreFilters')}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={ListFilter}
                  label={t('shell.objectList.moreFilters')}
                  active={extraActive}
                  className={cn(HEADER_TOOL_CLASS, extraActive && 'border-accent/30')}
                />
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuItems items={filterMenu} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <RefreshButton />
      </div>
      {segments.length > 0 || filtersActive ? (
        <div className="flex min-w-0 shrink-0 items-center gap-1 px-3 pb-2 pt-0.5">
          {segments.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              count={counts[s.id]}
              selected={currentSegment === s.id}
              onClick={() => useShellStore.getState().setListSegment(s.id === firstSegment ? null : s.id)}
              className="@max-[272px]/list:px-2"
            />
          ))}
          {/* Below 272px the menu's 清除筛选 and the first chip still clear everything; the icon would push the chips out. */}
          {filtersActive ? (
            <Tooltip content={t('shell.objectList.clearFilters')}>
              <IconButton
                icon={X}
                label={t('shell.objectList.clearFilters')}
                size="sm"
                onClick={() => useShellStore.getState().clearListFilters()}
                className="ml-auto @max-[272px]/list:hidden"
              />
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ListHeaderContext.Provider value={headerApi}>
          {Body ? (
            // Keyed by function: the body remounts on a rail switch, and a crashed list does not leave its error behind.
            <ErrorBoundary key={fn} compact>
              <Body query={query} activeObjectId={activeObjectId} />
            </ErrorBoundary>
          ) : (
            <EmptyState compact title={t('shell.objectList.noList')} className="h-full" />
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
  const t = useT()
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
      if (result.phase === 'error' && result.error)
        toast.error(t('shell.objectList.syncFailed'), {
          detail: result.error,
          action: { label: t('common.retry'), onClick: () => void onRefresh() },
        })
      else if (result.phase === 'idle') toast.success(t('shell.objectList.syncDone'))
    } catch (e) {
      toast.error(t('shell.objectList.syncFailed'), {
        detail: e instanceof Error ? e.message : String(e),
        action: { label: t('common.retry'), onClick: () => void onRefresh() },
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [t])

  const tip = syncing
    ? sync?.progress
      ? t('shell.objectList.syncingProgress', { done: sync.progress.done, total: sync.progress.total })
      : t('shell.objectList.syncing')
    : sync?.lastSyncedAt
      ? t('shell.objectList.syncedAt', { time: formatClock(sync.lastSyncedAt) })
      : t('shell.objectList.neverSynced')
  return (
    <Tooltip content={tip}>
      <IconButton
        icon={RefreshCw}
        label={t('common.refresh')}
        loading={syncing}
        onClick={() => void onRefresh()}
        className={HEADER_TOOL_CLASS}
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
