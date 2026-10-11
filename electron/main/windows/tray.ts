/**
 * System tray for the "keep running after the window closes" behaviour on Windows and Linux. macOS keeps the app in
 * the Dock (clicking it fires `activate`), so it needs no status item; elsewhere a hidden window with no tray icon
 * can never be brought back, so the tray is created before the window is hidden and lives until the app quits.
 * Electron objects are injected: the menu template and the lifecycle are unit-tested without a display.
 */
import type { MenuItemConstructorOptions } from 'electron'

export interface TrayLabels {
  show: string
  quit: string
}

export interface TrayHandlers {
  show(): void
  quit(): void
}

/** 显示 AIWC — 退出: the two things a tray icon must always offer. */
export function trayMenuTemplate(labels: TrayLabels, handlers: TrayHandlers): MenuItemConstructorOptions[] {
  return [
    { label: labels.show, click: () => handlers.show() },
    { type: 'separator' },
    { label: labels.quit, click: () => handlers.quit() },
  ]
}

/** Whether hiding the window needs a tray icon to stay reachable. */
export function needsTray(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin'
}

export interface TrayHandle {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click' | 'double-click', listener: () => void): void
  destroy(): void
}

export interface TrayDeps extends TrayHandlers {
  platform: NodeJS.Platform
  tooltip: string
  /** Read at build time so a language switch is picked up by `refresh()`. */
  labels(): TrayLabels
  createTray(): TrayHandle
  buildMenu(template: MenuItemConstructorOptions[]): unknown
}

export interface TrayController {
  /** Create the icon if this platform needs one; idempotent. */
  ensure(): void
  /** Rebuild the menu (UI language changed). */
  refresh(): void
  dispose(): void
}

export function createTrayController(deps: TrayDeps): TrayController {
  let tray: TrayHandle | undefined
  const applyMenu = () => {
    tray?.setContextMenu(deps.buildMenu(trayMenuTemplate(deps.labels(), deps)))
  }
  return {
    ensure() {
      if (tray || !needsTray(deps.platform)) return
      tray = deps.createTray()
      tray.setToolTip(deps.tooltip)
      tray.on('click', () => deps.show())
      tray.on('double-click', () => deps.show())
      applyMenu()
    },
    refresh() {
      applyMenu()
    },
    dispose() {
      tray?.destroy()
      tray = undefined
    },
  }
}
