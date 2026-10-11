/**
 * 搜索聊天记录 Tab (kind 'search', one instance; DESIGN-SPEC「全局搜索」). Searches the local index of every chat —
 * substrate:search in keyword mode, so no model is called and nothing leaves the computer (CLAUDE.md §6).
 * Header: title, the box, the chats, the time range. Body: where the data goes, then the start page (hint + 最近搜索),
 * the hits grouped by chat, or the not-connected / loading / error / no-results state. `tab.state` holds the search
 * (query, chats, range), so a tab that is reopened or remounted shows the same one. Nothing here assumes the
 * workbench: in the Agent window the tab opens in the workspace pane like any other.
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { SearchHit } from '@aiwc/protocol'
import { onCommand, runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { EmptyState } from '@/kit'
import { useAccountStatus } from '@/platform/useAccountStatus'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { rememberSearch } from './recentSearches'
import { SearchHeader } from './SearchHeader'
import { SearchResults } from './SearchResults'
import { SearchStart } from './SearchStart'
import { groupHits, hasFilters, parseSearchState, searchGate, type SearchTabState } from './searchModel'
import { useChats } from './useChats'
import { useHistorySearch } from './useHistorySearch'
import { focusedFindScope } from '@/platform/focusScope'

export function SearchTab({ tab, active, update }: TabRendererProps) {
  const t = useT()
  const state = useMemo(() => parseSearchState(tab.state), [tab.state])
  const status = useAccountStatus()
  const gate = searchGate(status.data?.connection, status.loading && !status.data)
  const search = useHistorySearch(state, gate === 'ready')
  const groups = useMemo(() => groupHits(search.hits), [search.hits])
  const chatIds = useMemo(() => [...state.sessionIds, ...groups.map((g) => g.sessionId)], [state.sessionIds, groups])
  const { chat } = useChats(chatIds, gate === 'ready')
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘F while this tab is in front focuses its box, as it does in the chat and settings tabs.
  useEffect(() => {
    if (!active) return
    return onCommand('search.inPage', () => {
      if (focusedFindScope()) return
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [active])

  /** Merge into the tab's state as stored now: a debounced commit may land after another change. */
  const patch = useCallback(
    (next: Partial<SearchTabState>) => {
      const stored = useTabsStore.getState().tabs.find((x) => x.id === tab.id)?.state
      update({ state: { ...parseSearchState(stored), ...next } })
    },
    [tab.id, update],
  )

  const submit = (query: string) => {
    rememberSearch(query)
    if (query === state.query) search.rerun()
    else patch({ query })
  }
  const pickRecent = (query: string) => {
    rememberSearch(query)
    patch({ query, request: state.request + 1 })
  }
  const openHit = useCallback(
    (hit: SearchHit) => {
      rememberSearch(state.query)
      const { sessionId, id } = hit.message
      runCommand('tab.openChat', { sessionId, title: chat(sessionId)?.title ?? '', focusMessageId: id })
    },
    [state.query, chat],
  )
  const onlyChat = useCallback((sessionId: string) => patch({ sessionIds: [sessionId] }), [patch])
  const filtered = hasFilters(state)

  let body: ReactNode
  if (gate === 'not_connected') {
    body = (
      <EmptyState
        title={t('search.empty.notConnected')}
        description={t('search.empty.notConnectedHint')}
        action={{
          label: t('search.empty.connect'),
          onClick: () => runCommand('tab.openSettings', { page: 'account' }),
        }}
        className="min-h-0 flex-1"
      />
    )
  } else if (!state.query) {
    body = <SearchStart onPick={pickRecent} />
  } else if (gate === 'waiting') {
    body = <EmptyState variant="loading" title={t('search.empty.connecting')} className="min-h-0 flex-1" />
  } else if (search.hits.length > 0) {
    body = (
      <SearchResults
        query={state.query}
        groups={groups}
        search={search}
        chat={chat}
        onOpenHit={openHit}
        onOnlyChat={onlyChat}
      />
    )
  } else if (search.pending) {
    body = <EmptyState variant="loading" title={t('search.empty.searching')} className="min-h-0 flex-1" />
  } else if (search.error) {
    body = (
      <EmptyState
        variant="error"
        title={t('search.empty.failed')}
        description={search.error.message}
        action={{ label: t('common.retry'), onClick: search.rerun }}
        className="min-h-0 flex-1"
      />
    )
  } else {
    body = (
      <EmptyState
        variant="no-results"
        title={t('search.empty.noResults', { query: state.query })}
        description={filtered ? t('search.empty.noResultsFiltered') : t('search.empty.noResultsHint')}
        action={
          filtered
            ? {
                label: t('search.empty.clearFilters'),
                onClick: () => patch({ sessionIds: [], range: { preset: 'all' } }),
              }
            : undefined
        }
        className="min-h-0 flex-1"
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-content">
      <SearchHeader
        key={state.request}
        initialQuery={state.query}
        committed={state.query}
        sessionIds={state.sessionIds}
        range={state.range}
        chat={chat}
        connected={gate === 'ready'}
        autoFocus={active}
        inputRef={inputRef}
        onCommit={(query) => patch({ query })}
        onSubmit={submit}
        onScopeChange={(sessionIds) => patch({ sessionIds })}
        onRangeChange={(range) => patch({ range })}
      />
      {body}
    </div>
  )
}
