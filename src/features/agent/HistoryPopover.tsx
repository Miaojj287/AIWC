/**
 * History popover of the Agent panel's tab strip: recent threads (all of them on demand, older pages through 加载更多)
 * and a search over the titles and the words inside every conversation on this computer (threadSearch.ts, shared with
 * the Agent window sidebar). A content hit opens its thread at that turn. Rows are kit menu items (h42 with
 * description) inside a Popover, since the list also carries a SearchBox.
 */
import { Archive, ArrowLeft, Ellipsis, History, MessageSquare, Pin, TextSearch } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { ThreadId, ThreadSearchHit, ThreadSummary } from '@aiwc/protocol'
import { useT } from '@/i18n'
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
  menuItemClass,
  MenuItemContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchBox,
  Tooltip,
} from '@/kit'
import { formatTime } from '@/platform/format'
import { listKeyNav } from '@/platform/listNavigation'
import { useAgentStore } from './agentStore'
import { isUntitledTitle } from './model'
import { SnippetText } from './SnippetText'
import { contentOnlyHits, useThreadSearch } from './threadSearch'
import { threadRowMenu, type ThreadAction } from './threadMenus'
import { filterThreads } from './window/threadGroups'

const RECENT_LIMIT = 5

/**
 * Kit menu item (h42 with description) used outside a Radix menu: hover / focus stand in for data-highlighted.
 * `kit-row` opts the rows into listKeyNav (↑ / ↓ / Home / End); the class carries no styles of its own here.
 */
const HISTORY_ROW_CLASS = cn(menuItemClass({ description: true }), 'kit-row hover:bg-hover-7 focus-visible:bg-hover-7')
const FOOTER_ROW_CLASS = cn(menuItemClass({}), 'w-full text-left hover:bg-hover-7 focus-visible:bg-hover-7')

export interface HistoryPopoverProps {
  all: ThreadSummary[]
  activeId: ThreadId | null
  onSelect: (id: ThreadId) => void
  onPin: (id: ThreadId, pinned: boolean) => void
  onAction: (action: ThreadAction, id: ThreadId) => void
}

export function HistoryPopover({ all, activeId, onSelect, onPin, onAction }: HistoryPopoverProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  // 已归档: the archived threads replace the recent ones until 返回.
  const [archivedMode, setArchivedMode] = useState(false)
  const hasMore = useAgentStore((s) => s.hasMoreThreads)
  const loadingMore = useAgentStore((s) => s.loadingMoreThreads)
  const archived = useAgentStore((s) => s.archived)
  const archivedLoading = useAgentStore((s) => s.archivedLoading)
  const untitled = t('agent.thread.untitled')
  const source = archivedMode ? archived : all
  const filtered = useMemo(() => filterThreads(source, query, untitled), [source, query, untitled])
  const search = useThreadSearch(open && !archivedMode ? query : '')
  const contentHits = useMemo(() => contentOnlyHits(search.hits, filtered), [search.hits, filtered])
  const rows = showAll || query || archivedMode ? filtered : filtered.slice(0, RECENT_LIMIT)
  // One tab stop for the whole list (roving tabindex): the row that last held focus, else the open thread, else
  // the first row. ↑ / ↓ / Home / End move between rows; the row's ··· is tabbable only on that row.
  const listRef = useRef<HTMLDivElement>(null)
  const [rovingId, setRovingId] = useState<ThreadId | undefined>(undefined)
  const tabStopId =
    rows.find((thread) => thread.threadId === rovingId)?.threadId ??
    rows.find((thread) => thread.threadId === activeId)?.threadId ??
    rows[0]?.threadId
  const reset = () => {
    setOpen(false)
    setQuery('')
    setShowAll(false)
    setArchivedMode(false)
  }
  const showArchived = (next: boolean) => {
    setArchivedMode(next)
    setQuery('')
    if (next) void useAgentStore.getState().loadArchived()
  }
  const pick = (id: ThreadId) => {
    onSelect(id)
    reset()
  }
  const reveal = (hit: ThreadSearchHit) => {
    reset()
    useAgentStore.getState().revealItem(hit.threadId, hit.itemId)
  }
  /** Close first: the rename / delete dialogs are modal and must not open under this popover. */
  function run(action: ThreadAction, id: ThreadId): void
  function run(fn: () => void): void
  function run(a: ThreadAction | (() => void), id?: ThreadId): void {
    reset()
    if (typeof a === 'function') a()
    else if (id) onAction(a, id)
  }
  const nothing = rows.length === 0 && contentHits.length === 0
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setQuery('')
          setShowAll(false)
          setArchivedMode(false)
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
          {archivedMode
            ? t('agent.stream.archive.section')
            : showAll
              ? t('agent.history.all')
              : t('agent.history.recent')}
        </div>
        <SearchBox
          size="sm"
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t('agent.history.searchPlaceholder')}
          aria-label={t('agent.history.search')}
          wrapperClassName="mx-0.5"
          onKeyDown={(e) => {
            // ↓ from the search box steps into the list, like any search-over-list popover.
            if (e.key !== 'ArrowDown') return
            const row = listRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')
            if (!row) return
            e.preventDefault()
            row.focus()
          }}
        />
        <div
          ref={listRef}
          role="listbox"
          aria-label={t('agent.history.list')}
          onKeyDown={listKeyNav}
          aria-busy={search.loading || undefined}
          className="mt-1 flex max-h-[300px] flex-col gap-px overflow-y-auto"
        >
          {nothing && archivedMode ? (
            <EmptyState
              variant={archivedLoading ? 'loading' : query ? 'no-results' : 'empty'}
              title={
                archivedLoading
                  ? t('agent.stream.archive.loading')
                  : query
                    ? t('agent.history.noResults')
                    : t('agent.stream.archive.empty')
              }
              compact
              className="py-4"
            />
          ) : nothing ? (
            <HistoryEmpty all={all.length} search={search} />
          ) : (
            <>
              <Section label={search.active && rows.length > 0 ? t('agent.history.titleMatches') : undefined}>
                {rows.map((thread) => {
                  const selected = thread.threadId === activeId
                  const tabStop = thread.threadId === tabStopId
                  const title = isUntitledTitle(thread.title) ? untitled : thread.title
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
                          tabIndex={tabStop ? 0 : -1}
                          onFocus={() => setRovingId(thread.threadId)}
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
                            selected &&
                              'bg-accent-12 hover:bg-accent-12 focus-visible:bg-accent-12 [&>svg]:text-accent',
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
                                      tabIndex={tabStop ? 0 : -1}
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
                })}
              </Section>
              {contentHits.length > 0 ? (
                <Section label={t('agent.history.contentMatches')}>
                  {contentHits.map((hit, i) => (
                    <div
                      key={hit.threadId}
                      role="option"
                      aria-selected={false}
                      tabIndex={rows.length === 0 && i === 0 ? 0 : -1}
                      onClick={() => reveal(hit)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          reveal(hit)
                        }
                      }}
                      className={HISTORY_ROW_CLASS}
                    >
                      <MenuItemContent
                        icon={TextSearch}
                        label={isUntitledTitle(hit.title) ? untitled : hit.title}
                        description={<SnippetText snippet={hit.snippet} />}
                      />
                    </div>
                  ))}
                </Section>
              ) : search.active && search.loading ? (
                <div className="px-2.5 py-1.5 text-micro text-fg-3">{t('agent.history.searching')}</div>
              ) : null}
            </>
          )}
        </div>
        {archivedMode ? (
          <>
            <Divider strength={8} className="my-1" />
            <button type="button" onClick={() => showArchived(false)} className={FOOTER_ROW_CLASS}>
              <MenuItemContent icon={ArrowLeft} label={t('agent.stream.archive.back')} />
            </button>
          </>
        ) : null}
        {!archivedMode && !query && all.length > RECENT_LIMIT ? (
          <>
            <Divider strength={8} className="my-1" />
            <button type="button" onClick={() => setShowAll((v) => !v)} className={FOOTER_ROW_CLASS}>
              <MenuItemContent
                icon={History}
                label={showAll ? t('agent.history.showRecent') : t('agent.history.showAll', { n: all.length })}
              />
            </button>
          </>
        ) : null}
        {!archivedMode && !query ? (
          <>
            {all.length <= RECENT_LIMIT ? <Divider strength={8} className="my-1" /> : null}
            <button type="button" onClick={() => showArchived(true)} className={FOOTER_ROW_CLASS}>
              <MenuItemContent icon={Archive} label={t('agent.stream.archive.section')} />
            </button>
          </>
        ) : null}
        {!archivedMode && !query && (showAll || all.length <= RECENT_LIMIT) && hasMore ? (
          <button
            type="button"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={() => void useAgentStore.getState().loadMoreThreads()}
            className={FOOTER_ROW_CLASS}
          >
            <MenuItemContent icon={History} label={t('agent.history.loadMore')} />
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** A labelled group of options inside the listbox (no label: the rows stand alone). */
function Section({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return <>{children}</>
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-px">
      <div aria-hidden className="px-2.5 pb-0.5 pt-1.5 text-micro font-medium text-fg-3">
        {label}
      </div>
      {children}
    </div>
  )
}

function HistoryEmpty({ all, search }: { all: number; search: ReturnType<typeof useThreadSearch> }) {
  const t = useT()
  if (search.active && search.loading)
    return <EmptyState variant="loading" title={t('agent.history.searching')} compact className="py-4" />
  if (search.error)
    return (
      <EmptyState
        variant="error"
        title={t('agent.history.searchFailed', { detail: search.error })}
        compact
        className="py-4"
      />
    )
  if (search.active)
    return (
      <EmptyState
        variant="no-results"
        title={t('agent.history.noResults')}
        description={t('agent.history.searchLocal')}
        compact
        className="py-4"
      />
    )
  return (
    <EmptyState
      variant={all === 0 ? 'empty' : 'no-results'}
      title={all === 0 ? t('agent.history.empty') : t('agent.history.noResults')}
      compact
      className="py-4"
    />
  )
}
