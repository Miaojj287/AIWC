/** settings.todo — 设置 › 每日待办 (src/features/settings/pages/TodoPage.tsx). */
export const todo = {
  sections: {
    main: '每日待办',
    scope: '扫描范围',
    schedule: '扫描周期',
    model: '模型',
  },
  enabled: {
    title: '开启每日待办',
  },
  dashboard: {
    title: '待办面板',
    open: '打开',
  },
  sources: {
    title: '扫描的群聊',
    none: '还没有选择，只有选中的群聊会被读取',
    count: '已选 {n} 个，最多 {max} 个',
    pick: '选择群聊',
    remove: '不再扫描「{name}」',
  },
  maxMessages: {
    title: '每个群最多读取',
    description: '每次扫描只读每个群最新的这些消息',
    option: '{n} 条',
  },
  schedule: {
    title: '扫描周期',
    kinds: { hourly: '每隔几小时', daily: '每天', manual: '仅手动' },
    interval: '间隔',
    intervalOption: '每 {n} 小时',
    time: '时间',
    invalidTime: '请输入 00:00–23:59 之间的时间',
    next: '下次扫描：{time}',
    manualHint: '只在你点「立即扫描」时扫描',
    offHint: '开启并选择群聊后按周期扫描',
    /** Behind the ? of the schedule section. */
    help: '只读取上次扫描之后的新消息。应用没开着时错过的扫描，会在下次启动约 1 分钟后补上一次。',
  },
  model: {
    title: '整理用的模型',
    description: '不选则用默认模型',
  },
}
