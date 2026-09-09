/**
 * Application menu. Items do not act in main — they emit `app:command` to the renderer, using the
 * command names from src/app/commands.ts, so shortcuts behave the same whether triggered by the
 * menu or by the in-app key handler.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'

/** Mirror of src/app/commands.ts names the menu is allowed to emit (renderer owns the type). */
export type MenuCommand =
  | 'tab.openSettings'
  | 'agent.newThread'
  | 'tab.closeActive'
  | 'tab.reopenClosed'
  | 'rail.select'
  | 'objectList.toggleCollapsed'
  | 'agent.toggleCollapsed'
  | 'search.sessions'
  | 'search.inPage'
  | 'tab.openDiary'
  | 'tab.openReplyDesk'

export interface MenuDeps {
  send: (command: MenuCommand, payload?: unknown) => void
  openDataDir: () => void
  exportLogs: () => void
  isMac: boolean
  isPackaged: boolean
  appName?: string
}

export function buildMenuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const name = deps.appName ?? 'AIWC'
  const cmd = (command: MenuCommand, payload?: unknown) => () => deps.send(command, payload)

  const settingsItem: MenuItemConstructorOptions = { label: '设置…', accelerator: 'CmdOrCtrl+,', click: cmd('tab.openSettings') }

  const appMenu: MenuItemConstructorOptions[] = deps.isMac
    ? [
        {
          label: name,
          submenu: [
            { role: 'about', label: `关于 ${name}` },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services', label: '服务' },
            { type: 'separator' },
            { role: 'hide', label: `隐藏 ${name}` },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: `退出 ${name}` },
          ],
        },
      ]
    : []

  const fileMenu: MenuItemConstructorOptions = {
    label: '文件',
    submenu: [
      { label: '新 Agent 会话', accelerator: 'CmdOrCtrl+N', click: cmd('agent.newThread', {}) },
      { type: 'separator' },
      { label: '关闭标签', accelerator: 'CmdOrCtrl+W', click: cmd('tab.closeActive') },
      { label: '恢复已关闭的标签', accelerator: 'CmdOrCtrl+Shift+T', click: cmd('tab.reopenClosed') },
      ...(deps.isMac ? [] : ([{ type: 'separator' }, settingsItem, { type: 'separator' }, { role: 'quit', label: '退出' }] as MenuItemConstructorOptions[])),
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      { label: '聊天', accelerator: 'CmdOrCtrl+1', click: cmd('rail.select', { fn: 'chat' }) },
      { label: '自动回复', accelerator: 'CmdOrCtrl+2', click: cmd('rail.select', { fn: 'autoreply' }) },
      { label: 'AI 克隆', accelerator: 'CmdOrCtrl+3', click: cmd('rail.select', { fn: 'clone' }) },
      { type: 'separator' },
      { label: '搜索会话…', accelerator: 'CmdOrCtrl+K', click: cmd('search.sessions') },
      { label: '在当前页查找', accelerator: 'CmdOrCtrl+F', click: cmd('search.inPage') },
      { type: 'separator' },
      { label: '收起 / 展开侧栏', accelerator: 'CmdOrCtrl+Shift+B', click: cmd('objectList.toggleCollapsed') },
      { label: '收起 / 展开 Agent 面板', accelerator: 'CmdOrCtrl+Shift+J', click: cmd('agent.toggleCollapsed') },
      { type: 'separator' },
      { label: '今日日记', click: cmd('tab.openDiary', {}) },
      { label: '回复台', click: cmd('tab.openReplyDesk') },
      { type: 'separator' },
      ...(deps.isPackaged
        ? []
        : ([
            { role: 'reload', label: '重新加载' },
            { role: 'toggleDevTools', label: '开发者工具' },
            { type: 'separator' },
          ] as MenuItemConstructorOptions[])),
      { role: 'togglefullscreen', label: '全屏' },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: '窗口',
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      ...(deps.isMac ? ([{ type: 'separator' }, { role: 'front', label: '全部置于顶层' }] as MenuItemConstructorOptions[]) : [{ role: 'close', label: '关闭窗口' } as MenuItemConstructorOptions]),
    ],
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: '帮助',
    role: 'help',
    submenu: [
      { label: '打开数据目录', click: () => deps.openDataDir() },
      { label: '导出日志', click: () => deps.exportLogs() },
    ],
  }

  return [...appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
}

export function installApplicationMenu(deps: MenuDeps): Menu {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(deps))
  Menu.setApplicationMenu(menu)
  return menu
}
