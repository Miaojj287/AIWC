/**
 * The single main window (four-column shell lives in the renderer). Restores size/position,
 * hides the native title bar (macOS inset traffic lights / Windows title-bar overlay), and turns
 * the close button into the configured behaviour (quit / minimize / ask).
 */
import { BrowserWindow, Menu, nativeTheme, screen, shell, type WebContents } from 'electron'
import { DEFAULT_APPEARANCE, type EventMap } from '@aiwc/protocol'
import { t } from '../i18n'
import type { ConfigService } from '../config/configService'
import type { Logger } from '../log'
import type { AppPaths } from '../paths'
import {
  debounce,
  fitToDisplays,
  loadWindowState,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  minimumSizeFor,
  saveWindowState,
  type WindowState,
} from './windowState'
import { editContextMenuTemplate } from './editContextMenu'
import {
  describeLoadFailure,
  describePreloadError,
  describeRendererGone,
  type RendererFault,
} from './preloadDiagnostics'
import { applyNativeChrome, nativeChromeColors, titleBarOverlayFor, type NativeChromeColors } from './nativeChrome'
import { applyTransparency, currentSystemVersion, supportsTransparency, transparencyOptionsFor } from './transparency'

export type { RendererFault } from './preloadDiagnostics'

/** Chromium's ERR_ABORTED: a navigation superseded by another one, not a real failure. */
const ERR_ABORTED = -3

/**
 * First-paint colours when no palette is known (tests, callers without a config): the default dark shell ground,
 * never a local grey. The live window derives them from the user's palette (nativeChrome.ts).
 */
export const SHELL_BACKGROUND = DEFAULT_APPEARANCE.dark.surface
export const SHELL_FOREGROUND = DEFAULT_APPEARANCE.dark.foreground
export const TITLE_BAR_HEIGHT = 32
const DEFAULT_CHROME: NativeChromeColors = { background: SHELL_BACKGROUND, foreground: SHELL_FOREGROUND }

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
  /** About to hide the window instead of closing it: the host makes sure it can be brought back (the tray). */
  onBeforeHide?: () => void
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

export function windowOptionsFor(
  platform: NodeJS.Platform,
  state: WindowState,
  preload: string,
  isPackaged: boolean,
  appIcon?: string,
  transparency = false,
  systemVersion?: string,
  chrome: NativeChromeColors = DEFAULT_CHROME,
): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: 'AIWC',
    // The page base before the renderer paints: the shell ground of the user's palette, so launch never flashes.
    backgroundColor: chrome.background,
    ...(appIcon ? { icon: appIcon } : {}),
    ...transparencyOptionsFor(platform, transparency, systemVersion),
    webPreferences: {
      preload,
      // Security baseline (AGENTS.md §3.6). `sandbox` is Electron's default too; stated so a refactor cannot drop it.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !isPackaged,
    },
  }
  if (platform === 'darwin') {
    return { ...base, titleBarStyle: 'hidden', trafficLightPosition: { x: 8, y: 12 } }
  }
  if (platform === 'win32') {
    return {
      ...base,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlayFor(chrome, TITLE_BAR_HEIGHT),
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
    const systemVersion = currentSystemVersion()
    const general = deps.config.get().general
    const chrome = () => nativeChromeColors(deps.config.get().general, nativeTheme.shouldUseDarkColors)
    const glass = (transparency: boolean) => transparency && supportsTransparency(platform, systemVersion)
    const bounds = { x: state.x ?? 0, y: state.y ?? 0, width: state.width, height: state.height }
    const minimum = minimumSizeFor(screen.getDisplayMatching(bounds).workArea)
    const w = new BrowserWindow({
      ...windowOptionsFor(
        platform,
        state,
        deps.preload,
        deps.isPackaged,
        deps.appIcon,
        general.transparency,
        systemVersion,
        nativeChromeColors(general, nativeTheme.shouldUseDarkColors),
      ),
      webPreferences: {
        ...windowOptionsFor(platform, state, deps.preload, deps.isPackaged).webPreferences,
        ...(deps.paths.accountScope ? { partition: `persist:account-${deps.paths.accountScope}` } : {}),
      },
      minWidth: minimum.width,
      minHeight: minimum.height,
    })
    win = w
    // The minimum follows the display the window is on: moving to a small or heavily scaled screen must not leave
    // a window that cannot fit its work area.
    const fitMinimumSize = () => {
      if (w.isDestroyed()) return
      const next = minimumSizeFor(screen.getDisplayMatching(w.getBounds()).workArea)
      w.setMinimumSize(next.width, next.height)
    }
    screen.on('display-metrics-changed', fitMinimumSize)
    w.on('moved', fitMinimumSize)
    // The renderer lays its custom chrome out around the native state (macOS controls hide in full screen).
    const sendWindowState = () => {
      if (w.isDestroyed() || w.webContents.isDestroyed()) return
      const payload: EventMap['app:windowState'] = { fullscreen: w.isFullScreen(), maximized: w.isMaximized() }
      w.webContents.send('app:windowState', payload)
    }
    for (const event of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize'] as const)
      w.on(event as 'maximize', sendWindowState)
    w.webContents.on('did-finish-load', sendWindowState)
    // Native text menu (Undo … Select All / Copy). The app's own object menus cancel the DOM event, so only
    // text fields and selections get here.
    w.webContents.on('context-menu', (_event, params) => {
      const template = editContextMenuTemplate(params, {
        undo: t('menu.undo'),
        redo: t('menu.redo'),
        cut: t('menu.cut'),
        copy: t('menu.copy'),
        paste: t('menu.paste'),
        selectAll: t('menu.selectAll'),
      })
      if (template) Menu.buildFromTemplate(template).popup({ window: w })
    })
    // 透明效果 toggled from the settings row: swap the native material in place.
    const unsubscribeTransparency = deps.config.subscribe((next, prev) => {
      if (next.general.transparency === prev.general.transparency || w.isDestroyed()) return
      applyTransparency(w, platform, next.general.transparency, systemVersion, chrome().background)
    })
    // Native chrome follows the palette: the Windows caption buttons and the opaque page base repaint when the theme
    // or a palette colour changes, and when the OS switches appearance while the theme follows the system.
    const repaintChrome = () => {
      if (w.isDestroyed()) return
      applyNativeChrome(w, platform, chrome(), {
        transparent: glass(deps.config.get().general.transparency),
        overlayHeight: TITLE_BAR_HEIGHT,
      })
    }
    const unsubscribeChrome = deps.config.subscribe((next, prev) => {
      if (
        next.general.theme !== prev.general.theme ||
        JSON.stringify(next.general.appearance) !== JSON.stringify(prev.general.appearance)
      )
        repaintChrome()
    })
    nativeTheme.on('updated', repaintChrome)
    // Render fixed-size traffic lights; newer macOS versions enlarge native buttons.
    if (platform === 'darwin') {
      w.setWindowButtonVisibility(false)
      // AppKit may restore standard buttons after leaving native fullscreen.
      w.on('leave-full-screen', () => w.setWindowButtonVisibility(false))
    }
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
        deps.onBeforeHide?.()
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
      unsubscribeTransparency()
      unsubscribeChrome()
      nativeTheme.off('updated', repaintChrome)
      screen.off('display-metrics-changed', fitMinimumSize)
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
    w.webContents.on('preload-error', (_e, preloadPath, error) =>
      fault({ kind: 'preload', detail: describePreloadError(preloadPath, error) }),
    )
    w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return
      fault({ kind: 'load', detail: describeLoadFailure(validatedURL, errorCode, errorDescription) })
    })
    w.webContents.on('render-process-gone', (_e, details) =>
      fault({ kind: 'crash', detail: describeRendererGone(details) }),
    )

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
