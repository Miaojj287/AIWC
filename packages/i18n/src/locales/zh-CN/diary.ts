/** diary — the 日记 Tab (src/features/diary): date list, reader, generation, date labels. */
export const diary = {
  tab: { title: '日记' },
  nav: {
    title: '日记',
    count: '{n} 篇',
    loadFailed: '无法读取日记列表',
    emptyHint: '生成后会按月份列在这里',
    regenerateToday: '重新生成今天',
  },
  empty: {
    title: '还没有日记',
    description: '每天定时整理聊天与 Agent 对话，线索写入记忆',
  },
  generateToday: '生成今天的日记',
  settings: '日记设置',
  quote: '引用到 Agent',
  regenerate: '重新生成',
  /** Badges for an entry written without the model. */
  degraded: '降级',
  degradedEntry: '降级生成',
  header: {
    title: '日记',
    schedule: '每天定时自动整理',
  },
  reader: {
    loading: '正在读取日记…',
    loadFailed: '无法读取这一天的日记',
    missing: '这一天还没有日记',
    generateDay: '生成这一天的日记',
    nothing: '这一天没有可整理的内容',
    cues: '记忆线索',
    cuesSaved: '已写入 MEMORY',
  },
  generation: {
    preparing: '准备中',
    title: '正在生成 {date} 的日记',
    titleGeneric: '正在生成日记',
    description: '内容只在本机与所选模型之间传输',
    done: '已生成 {date} 的日记{degraded, select, true {（降级版）} other {}}',
    failed: '生成失败：{detail}',
  },
  regenerateConfirm: {
    /** `date` is the diary label (9月5日 周六) — the menu can target a day other than the one on screen. */
    title: '重新生成 {date} 的日记？',
    description: '将覆盖现有内容并更新记忆线索。',
  },
  /** Chip label when the diary is added to the Agent context. */
  quoteLabel: '日记 {date}',
  quoted: '已把 {date} 的日记加入当前 Agent 会话上下文',
  date: {
    weekdays: { sun: '周日', mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六' },
    /** 9月5日 周六 — list rows, toasts. `month` is 1–12. */
    label: '{month}月{day}日 {weekday}',
    /** 2026 年 9 月 5 日 · 周六 — reader header. */
    title: '{year} 年 {month} 月 {day} 日 · {weekday}',
    /** 2026 年 9 月 — month group heading. */
    month: '{year} 年 {month} 月',
  },
  /** Meta line: 生成于 14:32 · 128 条消息 · 6 个会话 */
  sources: {
    generatedAt: '生成于 {time}',
    messages: '{n} 条消息',
    sessions: '{n} 个会话',
    agentTurns: '{n} 轮 Agent 对话',
  },
}
