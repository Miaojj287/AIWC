/** search — 搜索聊天记录 (src/features/search): the full-history search tab, its filters, results and states. */
export const search = {
  tab: {
    title: '搜索聊天记录',
    titleWithQuery: '搜索「{query}」',
  },
  header: {
    title: '搜索聊天记录',
    input: '在全部聊天记录中搜索',
    scope: '搜索范围',
    range: '时间范围',
  },
  scope: {
    all: '全部聊天',
    some: '{n} 个聊天',
    find: '查找聊天',
    none: '没有匹配的聊天',
    loading: '正在加载聊天…',
  },
  range: {
    all: '全部时间',
    days7: '最近 7 天',
    days30: '最近 30 天',
    year: '最近一年',
    custom: '{from} – {to}',
    since: '{from} 之后',
    until: '{to} 之前',
  },
  /** One sentence on where the data goes (CLAUDE.md §6). */
  summary: {
    results: '{n} 条结果 · {chats} 个聊天',
    top: '前 {n} 条结果 · {chats} 个聊天',
    capped: '只显示前 {n} 条结果，换个更具体的词或缩小范围',
    searching: '正在搜索…',
    order: '聊天按相关度排列，聊天内的消息从新到旧',
  },
  results: {
    label: '搜索结果',
    loadMore: '加载更多结果',
    moreFailed: '没能加载更多结果',
  },
  group: {
    hits: '{n} 条相关记录',
    unknown: '未知聊天',
    moreActions: '「{name}」的更多操作',
  },
  hit: {
    moreActions: '这条消息的更多操作',
  },
  menu: {
    openInChat: '在聊天中查看',
    openChat: '打开聊天',
    onlyThisChat: '只搜这个聊天',
    copyText: '复制文字',
    quote: '引用到 Agent',
  },
  initial: {
    title: '在全部聊天记录中搜索',
    recent: '最近搜索',
    clearRecent: '清除',
    recentCleared: '已清除最近搜索',
    undo: '撤销',
    searchAgain: '搜索',
    removeRecent: '从最近搜索中移除',
    recentActions: '「{query}」的更多操作',
  },
  empty: {
    searching: '正在搜索…',
    failed: '搜索失败',
    noResults: '没有找到「{query}」',
    noResultsHint: '换个关键词试试',
    noResultsFiltered: '换个关键词，或放宽聊天和时间范围',
    clearFilters: '清除筛选',
    notConnected: '尚未连接微信',
    notConnectedHint: '连接后才能搜索这台电脑上的聊天记录',
    connect: '连接微信',
    connecting: '正在连接微信…',
  },
  toast: {
    /** `what` of common.copied. */
    messageText: '消息文字',
    quoted: '已引用到 Agent',
  },
}
