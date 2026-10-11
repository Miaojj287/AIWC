/**
 * 搜索聊天记录 — registers the search Tab (kind 'search', one instance) and `tab.openSearch`, its only handler. The
 * entries are ⇧⌘F, View ▸ 搜索聊天记录…, Enter or the search row in the chat list's search box, and its no-results
 * state. Opening the tab again applies the request to the same tab (searchModel `applyOpenRequest`).
 */
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerTab, tabId } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { rememberSearch } from './recentSearches'
import { SearchTab } from './SearchTab'
import { applyOpenRequest, parseOpenRequest, parseSearchState, SEARCH_OBJECT_ID } from './searchModel'

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({
    kind: 'search',
    icon: 'text-search',
    component: SearchTab,
    title: (tab) => {
      const { query } = parseSearchState(tab.state)
      return query ? t('search.tab.titleWithQuery', { query }) : t('search.tab.title')
    },
  })
  // The payload may come untyped from the native menu, so it is validated before use.
  onCommand('tab.openSearch', (payload) => openSearch(payload))
}

/** Open (or bring forward) the one search tab and apply the request to it. */
function openSearch(payload: unknown): void {
  const request = parseOpenRequest(payload)
  const tabs = useTabsStore.getState()
  const id = tabId('search', SEARCH_OBJECT_ID)
  const existing = tabs.tabs.find((tab) => tab.id === id)
  const state = applyOpenRequest(parseSearchState(existing?.state), request)
  if (request.query) rememberSearch(request.query)
  // `title` is the stored fallback; the strip shows the localized one registered above.
  tabs.open({ kind: 'search', objectId: SEARCH_OBJECT_ID, title: t('search.tab.title'), state })
  if (existing) tabs.update(id, { state })
}
