/** workspace — the Tab container (src/workspace): tab strip, tab menus, per-function empty state, unsaved-changes guard. */
export const workspace = {
  ariaLabel: '工作区',
  tabError: '无法显示此标签',
  closeTab: '关闭标签',
  empty: {
    chat: { title: '从左侧选择一个会话', description: '浏览、搜索、导出，或引用给 Agent' },
    autoreply: { title: '选择一个会话来设置自动回复', description: '每个会话一条规则，开启后按设定回复' },
    clone: { title: '选择一位联系人开始克隆', description: '从聊天记录提炼 TA 的说话风格' },
    tasks: { title: '选择一个定时任务', description: '或新建一个，让 Agent 按时替你做事' },
    /** `kbd` is the ⌘K key cap element. */
    search: '{kbd} 搜索',
  },
  discard: {
    title: '放弃修改？',
    description: '「{title}」的修改尚未保存，关闭后将丢失。',
    confirm: '放弃修改',
  },
  tabStrip: {
    ariaLabel: '工作区标签',
    manage: '标签管理',
    close: '关闭',
    closeOthers: '关闭其他',
    closeRight: '关闭右侧',
    pin: '固定标签',
    unpin: '取消固定',
    reopen: '恢复已关闭的标签',
    count: '标签页 · {n}',
    none: '没有打开的标签',
    current: '当前',
  },
}
