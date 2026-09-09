/**
 * The single main window (four-column shell lives in the renderer). Restores size/position,
 * hides the native title bar (macOS inset traffic lights / Windows title-bar overlay), and turns
 * the close button into the configured behaviour (quit / minimize / ask).
 */
import { BrowserWindow, screen, shell, type WebContents } from 'electron'
import type { ConfigService } from '../config/configService'
import type { Logger } from '../log'
import type { AppPaths } from '../paths'
import { debounce, fitToDisplays, loadWindowState, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, saveWindowState, type WindowState } from './windowState'
import { describeLoadFailure, describePreloadError, describeRendererGone, type RendererFault } from './preloadDiagnostics'

export type { RendererFault, RendererFaultKind } from './preloadDiagnostics'

/** Chromium's ERR_ABORTED: a navigation superseded by another one, not a real failure. */
const ERR_ABORTED = -3

export const SHELL_BACKGROUND = '#1a1b22'
export const SHELL_FOREGROUND = '#e8e9ee'
export const TITLE_BAR_HEIGHT = 48

export interface MainWindowDeps {
  paths: AppPaths
  config: ConfigService
  logger: Logger
  preload: string
  /** dist/index.html (used when no dev server) */
  rendererIndex: string
  devServerUrl?: string
  isPackaged: boolean
  /** Product artwork used by the live window/taskbar; the packaged app bundle uses the same source. */
  appIcon?: string
  isQuitting: () => boolean
  /** closeBehavior === 'ask': tell the renderer to show the choice dialog. */
  onCloseRequested: (win: BrowserWindow) => void
  requestQuit: () => void
  /**
   * The renderer will never come up: preload failed to load, main-frame load failed, or the renderer
   * process is gone. Already logged; the `--smoke` run uses it to fail fast.
   */
  onRendererFault?: (fault: RendererFault) => void
  platform?: NodeJS.Platform
}

export interface WindowManager {
  create(): BrowserWindow
  get(): BrowserWindow | undefined
  /** Create when missing, otherwise restore + focus. */
  ensure(): BrowserWindow
  hide(): void
  isTrustedSender(sender: WebContents): boolean
}

export function windowOptionsFor(platform: NodeJS.Platform, state: WindowState, preload: string, isPackaged: boolean, appIcon?: string): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: 'AIWC',
    backgroundColor: SHELL_BACKGROUND,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !isPackaged,
    },
  }
  if (platform === 'darwin') {
    return { ...base, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
  }
  if (platform === 'win32') {
    return {
      ...base,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: SHELL_BACKGROUND, symbolColor: SHELL_FOREGROUND, height: TITLE_BAR_HEIGHT },
    }
  }
  return base
}

export function createWindowManager(deps: MainWindowDeps): WindowManager {
  const log = deps.logger.child('window')
  const platform = deps.platform ?? process.platform
  const trusted = new Set<number>()
  let win: BrowserWindow | undefined

  function captureState(w: BrowserWindow): WindowState {
    const maximized = w.isMaximized()
    const bounds = maximized ? w.getNormalBounds() : w.getBounds()
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, maximized }
  }

  function create(): BrowserWindow {
    const displays = screen.getAllDisplays().map((d) => d.workArea)
    const state = fitToDisplays(loadWindowState(deps.paths.windowStateFile), displays)
    const w = new BrowserWindow(windowOptionsFor(platform, state, deps.preload, deps.isPackaged, deps.appIcon))
    win = w
    // Captured now: `w.webContents` throws "Object has been destroyed" inside the 'closed' handler.
    const webContentsId = w.webContents.id
    trusted.add(webContentsId)

    const persist = debounce((s: WindowState) => {
      try {
        saveWindowState(deps.paths.windowStateFile, s)
      } catch (e) {
        log.warn('save window state failed', e)
      }
    }, 400)
    const onBounds = () => {
      if (!w.isDestroyed()) persist(captureState(w))
    }
    w.on('resize', onBounds)
    w.on('move', onBounds)
    w.on('maximize', onBounds)
    w.on('unmaximize', onBounds)

    w.once('ready-to-show', () => {
      if (state.maximized) w.maximize()
      w.show()
    })

    w.on('close', (e) => {
      persist.flush()
      if (deps.isQuitting()) return
      const behavior = deps.config.get().general.closeBehavior
      e.preventDefault()
      if (behavior === 'minimize') {
        w.hide()
        return
      }
      if (behavior === 'quit') {
        deps.requestQuit()
        return
      }
      deps.onCloseRequested(w)
    })

    w.on('closed', () => {
      trusted.delete(webContentsId)
      if (win === w) win = undefined
    })

    // Never open popups; http(s) links go to the system browser.
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    w.webContents.on('will-navigate', (e, url) => {
      const allowed = deps.devServerUrl ? url.startsWith(deps.devServerUrl) : url.startsWith('file://')
      if (!allowed) {
        e.preventDefault()
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      }
    })
    const fault = (f: RendererFault) => {
      log.error(f.detail, { kind: f.kind })
      deps.onRendererFault?.(f)
    }
    // A sandboxed preload that cannot even be parsed (e.g. emitted as an ES module) leaves the page
    // without `window.aiwc`; the renderer would silently fall back to its mock bridge.
    w.webContents.on('preload-error', (_e, preloadPath, error) => fault({ kind: 'preload', detail: describePreloadError(preloadPath, error) }))
    w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return
      fault({ kind: 'load', detail: describeLoadFailure(validatedURL, errorCode, errorDescription) })
    })
    w.webContents.on('render-process-gone', (_e, details) => fault({ kind: 'crash', detail: describeRendererGone(details) }))

    if (deps.devServerUrl) {
      void w.loadURL(deps.devServerUrl)
    } else {
      void w.loadFile(deps.rendererIndex)
    }
    log.info('main window created', { state, dev: Boolean(deps.devServerUrl) })
    return w
  }

  return {
    create,
    get: () => (win && !win.isDestroyed() ? win : undefined),
    ensure() {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        return win
      }
      return create()
    },
    hide() {
      if (win && !win.isDestroyed()) win.hide()
    },
    isTrustedSender: (sender) => trusted.has(sender.id),
  }
}
