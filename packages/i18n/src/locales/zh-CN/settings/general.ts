/** settings.general — 常规 page (GeneralPage, AppearanceSettings). */
export const general = {
  /** 偏好 holds 默认界面 / 界面语言 / 开机自启 / 关闭窗口时 in one card: four one-row sections only repeated their row titles. */
  sections: { appearance: '外观', preferences: '偏好' },
  language: { title: '界面语言' },
  /** 默认界面: the same switch as the 「Agent 窗口」 / 「工作台」 pills (ui.shellMode). */
  layout: {
    title: '默认界面',
    workbench: '工作台',
    agent: 'Agent 窗口',
  },
  launchAtLogin: '开机自启',
  /** 发送消息: which key sends from the Agent composer (ui.composerSendKey). */
  sendKey: {
    title: '发送消息',
    description: '另一种组合键换行',
    enter: 'Enter',
    modEnter: '{mac, select, true {⌘ Enter} other {Ctrl+Enter}}',
  },
  /** 系统通知: OS notifications while AIWC is in the background. */
  notifications: {
    title: '系统通知',
    help: '待确认的操作、自动回复草稿、自动回复暂停和定时任务结果会弹出系统通知，点一下回到对应位置。窗口在前台时只在应用内提示。',
    showNames: '通知里显示联系人名称',
    showNamesDescription: '锁屏和通知中心会保留通知内容',
  },
  closeBehavior: '关闭窗口时',
  close: {
    quit: '退出',
    quitDescription: '自动回复与推送一并停止',
    minimize: '{tray, select, dock {保留在程序坞} other {最小化到系统托盘}}',
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
      help: '开启后左侧功能栏和列表变成毛玻璃，透出桌面壁纸与后面的窗口；工作区与 Agent 面板保持不透明。',
      unsupported: '当前平台不支持透明效果',
    },
    custom: {
      title: '自定义配色',
      help: '浅色与深色分别保存，默认与 Codex 一致。背景控制内容区，前景控制侧栏与卡片，字体控制正文并派生次级文字。',
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
    },
    /** The last row of the card: it resets the whole mode being edited, not just the preview above it. */
    reset: {
      title: '恢复默认外观',
      description: '{mode, select, light {还原浅色配色} other {还原深色配色}}，并重新打开透明效果',
      action: '恢复默认',
    },
  },
}
