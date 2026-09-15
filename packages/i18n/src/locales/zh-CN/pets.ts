/** pets — the Agent-panel companion (src/features/pets): moods, status bubble, pet menu, source labels. */
export const pets = {
  mood: {
    idle: '待机',
    running: '正在处理',
    waiting: '等你确认',
    review: '完成了',
    failed: '出错了',
  },
  bubble: {
    running: '正在处理',
    waiting: '需要你确认',
    review: '完成了',
    failed: '出错了',
    withDetail: '{title}：{detail}',
    dismiss: '点击收起',
  },
  pet: {
    label: '{name}：{status}',
    tooltip: '{detail} · 右键更多',
    tooltipMini: '{detail} · 点击展开 Agent 面板',
    poke: '摸摸它',
    change: '更换宠物…',
    hide: '隐藏宠物',
    hidden: '已隐藏宠物',
    hiddenDetail: '可以在「设置 › 宠物」里重新显示',
    hideFailed: '隐藏宠物失败',
  },
  source: {
    builtin: '内置',
    catalog: 'codex-pets.net',
    catalogBy: 'codex-pets.net · {author}',
    import: '本地导入',
  },
}
