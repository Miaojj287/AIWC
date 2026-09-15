/** app — renderer root (src/app) and platform helpers (src/platform): boot screen, config errors, close-behaviour dialog, tab commands, opening links / files. */
export const app = {
  bootFailed: '本地数据服务不可用',
  configError: '无法读取配置',
  starting: '正在启动',
  /** Toast when saving `onboarding.completed` fails and the window returns to the wizard; detail = the error. */
  onboardingSaveFailed: '无法完成设置',
  bridgeUnavailable: '无法连接本地微信数据服务，请在桌面应用中打开或重启应用。',
  closeDialog: {
    title: '关闭窗口',
    description: '最小化到{tray, select, menuBar {菜单栏} other {系统托盘}}可继续同步与自动回复',
    remember: '记住我的选择',
    rememberHint: '可在设置中修改',
    quit: '退出',
    minimize: '最小化到{tray, select, menuBar {菜单栏} other {系统托盘}}',
  },
  /** Stored fallback titles of fixed tabs; features register the display title (tabRegistry `title`). */
  tabs: {
    task: '定时任务',
    diary: '日记',
    replyDesk: '回复台',
    settings: '设置',
    kit: '组件库',
  },
  quote: {
    noTarget: '当前标签没有可引用到 Agent 的对象',
    noTargetHint: '打开一个会话、联系人或文件后再试',
  },
  /** shell.setMode / shell.toggleMode: persisting `ui.shellMode` failed; detail = the error. */
  layout: { switchFailed: '切换布局失败' },
  open: {
    linkFailed: '无法打开链接',
    /** `what` is a noun from the caller's namespace (zh 导出文件 / en export file). */
    pathFailed: '无法打开{what}',
    file: '文件',
    revealFailed: '无法在文件夹中显示',
  },
}
