import type { Messages } from '../zh-CN'

export const search: Messages['search'] = {
  tab: {
    title: 'Search chat history',
    titleWithQuery: 'Search "{query}"',
  },
  header: {
    title: 'Search chat history',
    input: 'Search all chat history',
    scope: 'Chats to search',
    range: 'Time range',
  },
  scope: {
    all: 'All chats',
    some: '{n, plural, one {# chat} other {# chats}}',
    find: 'Find a chat',
    none: 'No matching chats',
    loading: 'Loading chats…',
  },
  range: {
    all: 'Any time',
    days7: 'Past 7 days',
    days30: 'Past 30 days',
    year: 'Past year',
    custom: '{from} – {to}',
    since: 'Since {from}',
    until: 'Until {to}',
  },
  summary: {
    results: '{n, plural, one {# result} other {# results}} in {chats, plural, one {# chat} other {# chats}}',
    top: 'Top {n} results in {chats, plural, one {# chat} other {# chats}}',
    capped: 'Showing the first {n} results; try more specific words or a narrower range',
    searching: 'Searching…',
    order: 'Chats are ranked by relevance; messages in a chat run newest first',
  },
  results: {
    label: 'Search results',
    loadMore: 'Load more results',
    moreFailed: "Couldn't load more results",
  },
  group: {
    hits: '{n, plural, one {# match} other {# matches}}',
    unknown: 'Unknown chat',
    moreActions: 'More actions for "{name}"',
  },
  hit: {
    moreActions: 'More actions for this message',
  },
  menu: {
    openInChat: 'Open in chat',
    openChat: 'Open chat',
    onlyThisChat: 'Search only this chat',
    copyText: 'Copy text',
    quote: 'Add to Agent',
  },
  initial: {
    title: 'Search across all your chats',
    recent: 'Recent searches',
    clearRecent: 'Clear',
    recentCleared: 'Recent searches cleared',
    undo: 'Undo',
    searchAgain: 'Search',
    removeRecent: 'Remove from recent searches',
    recentActions: 'More actions for "{query}"',
  },
  empty: {
    searching: 'Searching…',
    failed: "Couldn't search",
    noResults: 'No results for "{query}"',
    noResultsHint: 'Try different words',
    noResultsFiltered: 'Try different words, or widen the chats and time range',
    clearFilters: 'Clear filters',
    notConnected: 'WeChat is not connected',
    notConnectedHint: 'Connect it to search the chat history on this computer',
    connect: 'Connect WeChat',
    connecting: 'Connecting to WeChat…',
  },
  toast: {
    messageText: 'Message text',
    quoted: 'Added to Agent',
  },
}
