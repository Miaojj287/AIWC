/**
 * Application menu. Items do not act in main — they emit `app:command` to the renderer, using the
 * command names from src/app/commands.ts, so shortcuts behave the same whether triggered by the
 * menu or by the in-app key handler. Labels come from @aiwc/i18n; index.ts rebuilds the menu when
 * `general.language` changes.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { t } from './i18n'

/** Mirror of src/app/commands.ts names the menu is allowed to emit (renderer owns the type). */
export type MenuCommand =
  | 'tab.openSettings'
  | 'agent.newThread'
  | 'tab.closeActive'
  | 'tab.reopenClosed'
  | 'rail.select'
  | 'objectList.toggleCollapsed'
  | 'agent.toggleCollapsed'
  | 'shell.toggleMode'
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

  const settingsItem: MenuItemConstructorOptions = {
    label: t('menu.settings'),
    accelerator: 'CmdOrCtrl+,',
    click: cmd('tab.openSettings'),
  }

  const appMenu: MenuItemConstructorOptions[] = deps.isMac
    ? [
        {
          label: name,
          submenu: [
            { role: 'about', label: t('menu.about', { name }) },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services', label: t('menu.services') },
            { type: 'separator' },
            { role: 'hide', label: t('menu.hide', { name }) },
            { role: 'hideOthers', label: t('menu.hideOthers') },
            { role: 'unhide', label: t('menu.unhide') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.quitApp', { name }) },
          ],
        },
      ]
    : []

  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file'),
    submenu: [
      { label: t('menu.newThread'), accelerator: 'CmdOrCtrl+N', click: cmd('agent.newThread', {}) },
      { type: 'separator' },
      { label: t('menu.closeTab'), accelerator: 'CmdOrCtrl+W', click: cmd('tab.closeActive') },
      { label: t('menu.reopenTab'), accelerator: 'CmdOrCtrl+Shift+T', click: cmd('tab.reopenClosed') },
      ...(deps.isMac
        ? []
        : ([
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'quit', label: t('menu.quit') },
          ] as MenuItemConstructorOptions[])),
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.undo') },
      { role: 'redo', label: t('menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.cut') },
      { role: 'copy', label: t('menu.copy') },
      { role: 'paste', label: t('menu.paste') },
      { role: 'selectAll', label: t('menu.selectAll') },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [
      { label: t('menu.chat'), accelerator: 'CmdOrCtrl+1', click: cmd('rail.select', { fn: 'chat' }) },
      { label: t('menu.autoreply'), accelerator: 'CmdOrCtrl+2', click: cmd('rail.select', { fn: 'autoreply' }) },
      { label: t('menu.clone'), accelerator: 'CmdOrCtrl+3', click: cmd('rail.select', { fn: 'clone' }) },
      { type: 'separator' },
      { label: t('menu.searchSessions'), accelerator: 'CmdOrCtrl+K', click: cmd('search.sessions') },
      { label: t('menu.findInPage'), accelerator: 'CmdOrCtrl+F', click: cmd('search.inPage') },
      { type: 'separator' },
      { label: t('menu.toggleObjectList'), accelerator: 'CmdOrCtrl+Shift+B', click: cmd('objectList.toggleCollapsed') },
      { label: t('menu.toggleAgentPanel'), accelerator: 'CmdOrCtrl+Shift+J', click: cmd('agent.toggleCollapsed') },
      { label: t('menu.toggleAgentWindow'), accelerator: 'CmdOrCtrl+Shift+L', click: cmd('shell.toggleMode') },
      { type: 'separator' },
      { label: t('menu.diary'), click: cmd('tab.openDiary', {}) },
      { label: t('menu.replyDesk'), click: cmd('tab.openReplyDesk') },
      { type: 'separator' },
      ...(deps.isPackaged
        ? []
        : ([
            { role: 'reload', label: t('menu.reload') },
            { role: 'toggleDevTools', label: t('menu.devTools') },
            { type: 'separator' },
          ] as MenuItemConstructorOptions[])),
      { role: 'togglefullscreen', label: t('menu.fullscreen') },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window'),
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: t('menu.minimize') },
      { role: 'zoom', label: t('menu.zoom') },
      ...(deps.isMac
        ? ([{ type: 'separator' }, { role: 'front', label: t('menu.front') }] as MenuItemConstructorOptions[])
        : [{ role: 'close', label: t('menu.closeWindow') } as MenuItemConstructorOptions]),
    ],
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help'),
    role: 'help',
    submenu: [
      { label: t('menu.openDataDir'), click: () => deps.openDataDir() },
      { label: t('menu.exportLogs'), click: () => deps.exportLogs() },
    ],
  }

  return [...appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
}

export function installApplicationMenu(deps: MenuDeps): Menu {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(deps))
  Menu.setApplicationMenu(menu)
  return menu
}
