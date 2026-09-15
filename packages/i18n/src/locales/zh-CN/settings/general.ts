/** settings.general — 常规 page (GeneralPage, AppearanceSettings). */
export const general = {
  sections: { appearance: '外观', startup: '启动' },
  language: { section: '语言', title: '界面语言' },
  /** 设置 › 常规 › 布局: the same switch as the 「Agent 窗口」 / 「工作台」 pills (ui.shellMode). */
  layout: {
    section: '布局',
    title: '默认界面',
    description: '工作台四列，或整窗的 Agent 对话',
    workbench: '工作台',
    agent: 'Agent 窗口',
  },
  launchAtLogin: '开机自启',
  closeBehavior: '关闭窗口时',
  close: {
    quit: '退出',
    quitDescription: '自动回复与推送一并停止',
    minimize: '最小化到菜单栏',
    minimizeDescription: '后台继续运行',
    ask: '每次询问',
    askDescription: '关闭时再选择',
  },
  /** AppearanceSettings. */
  appearance: {
    theme: '主题模式',
    themes: { system: '跟随系统', light: '浅色', dark: '深色' },
    transparency: {
      title: '透明效果',
      description: '功能栏与列表透出桌面背景',
      help: '开启后左侧功能栏和列表变成毛玻璃，透出桌面壁纸与后面的窗口；工作区与 Agent 面板保持不透明。macOS 与 Windows 11 桌面端可用。',
      unsupported: '当前平台不支持透明效果',
    },
    custom: {
      title: '自定义配色',
      description: '浅色与深色分别保存',
      help: '默认配色与 Codex 一致。背景控制内容区，前景控制侧栏与卡片，字体控制正文并派生次级文字。',
      mode: '编辑配色模式',
    },
    colors: { accent: '强调色', background: '背景', surface: '前景', foreground: '字体' },
    /** Color field labels: mode + color. */
    colorLabels: {
      light: { accent: '浅色强调色', background: '浅色背景', surface: '浅色前景', foreground: '浅色字体' },
      dark: { accent: '深色强调色', background: '深色背景', surface: '深色前景', foreground: '深色字体' },
    },
    contrast: { title: '对比度', description: '次级文字与分隔线的强度' },
    preview: {
      title: { light: '浅色预览', dark: '深色预览' },
      ratio: '正文对比度 {ratio}:1',
      ratioLow: '正文对比度 {ratio}:1 · 建议 ≥ 4.5:1',
      body: '这是正文 {secondary}',
      secondary: '与说明文字',
      secondaryAction: '次要操作',
      primaryAction: '主要操作',
      reset: '恢复默认外观',
    },
  },
}
