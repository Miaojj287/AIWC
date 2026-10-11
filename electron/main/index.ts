/**
 * Electron main entry (docs/ARCHITECTURE.md §3). Lifecycle only — everything else is composed in
 * composition.ts and exposed over IPC in ipc/*.
 *
 *   --smoke   create the window, wait for the renderer to call app:getInfo (≤15 s), exit 0/1. Any
 *             reason the renderer can never get there (single-instance lock held by another process,
 *             preload failed to load, page failed to load, renderer crashed) is logged and exits 1
 *             immediately — a smoke run must never pass by accident.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  session,
  shell,
  Tray,
  type BrowserWindow,
} from 'electron'
import { resolveAccountDir } from '@aiwc/substrate'
import type { AppConfig } from '@aiwc/protocol'
import { createPaths, ensureDirs, type AppPaths } from './paths'
import { createLogger, nullLogger, type Logger } from './log'
import { createBroadcast, sendToActive } from './broadcast'
import { createApp } from './composition'
import type { AppContext } from './contracts'
import { registerMediaProtocol, registerMediaScheme } from './protocols/mediaProtocol'
import { createWeChatVideoAccess } from './security/wechatVideoAccess'
import { createWindowManager, type WindowManager } from './windows/mainWindow'
import { isAppFocused, notificationsSupported, showNativeNotification } from './windows/nativeNotification'
import { createSystemNotifier } from './services/systemNotifier'
import { createTrayController } from './windows/tray'
import { applyLoginItem } from './services/loginItem'
import { installApplicationMenu, type MenuDeps } from './menu'
import { mainLanguage, setMainLanguage, t } from './i18n'
import { resolveLanguage } from '@aiwc/i18n'
import { registerIpc, type HostBridge } from './ipc/register'
import { diagnosticsRedaction, exportDiagnostics } from './services/diagnostics'
import { createPrivacyHost } from './windows/privacyHost'
import { openAccountProfile } from './services/accountProfiles'
import { createAccountSession, seedProfileSecrets, type AccountSession } from './services/accountSession'
import { applyPendingDataReset } from './services/dataReset'
import { DEV_RELAUNCH_EXIT_CODE, relaunchesThroughDevServer } from './devRelaunch'

const here = dirname(fileURLToPath(import.meta.url)) // dist-electron/
const SMOKE = process.argv.includes('--smoke')
const SMOKE_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 8_000
const APP_NAME = 'AIWC'
/** electron-builder `appId`: the Windows taskbar groups, pins and notifies under this identity. */
const APP_USER_MODEL_ID = 'com.aiwc.desktop'
/** Tray icons are 16pt; the OS picks the @2x representation itself on scaled displays. */
const TRAY_ICON_SIZE = 16

// In development Electron otherwise exposes its own bundle name in the macOS Dock and app menu.
// Packaged builds also set this from productName, but keeping it explicit makes every launch path
// present the same product identity.
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

let logger: Logger = nullLogger
let ctx: AppContext | undefined
let windows: WindowManager | undefined
let accountSession: AccountSession | undefined
let quitting = false
let shutdownDone = false
let devRelaunchOnExit = false

// Own userData directory (reverse-DNS, dev suffix) so we never share a data dir or the single-instance
// lock with the legacy "aiwc" app on a case-insensitive file system.
app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'com.aiwc.desktop' : 'com.aiwc.desktop-dev'))

// Privileged scheme registration must happen before 'ready'.
registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  if (SMOKE) {
    abortSmokeBeforeReady(
      `another AIWC instance already holds the single-instance lock for ${app.getPath('userData')} ` +
        '(any Electron app named "aiwc" using that directory, e.g. a running dev instance); quit it and rerun --smoke',
    )
  } else {
    app.quit()
  }
} else {
  app.on('second-instance', () => windows?.ensure())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (e) => {
    quitting = true
    if (shutdownDone) return
    e.preventDefault()
    void gracefulQuit(0)
  })
  app
    .whenReady()
    .then(bootstrap)
    .catch((e: unknown) => fatal(t('main.startupFailed'), e))
}

function buildPaths(): AppPaths {
  return createPaths({
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
  })
}

function openLogger(paths: AppPaths): Logger {
  return createLogger({
    file: paths.mainLogFile,
    level: app.isPackaged ? 'info' : 'debug',
    maxBytes: 2 * 1024 * 1024,
    maxFiles: 5,
  })
}

async function bootstrap(): Promise<void> {
  // Until the config is loaded, main-process copy (a fatal startup dialog) follows the OS language.
  setMainLanguage(resolveLanguage(app.getLocale()))
  const basePaths = buildPaths()
  // 清除全部数据 (设置 › 数据) relaunches with a marker: delete before anything opens the data root.
  const reset = applyPendingDataReset(basePaths)
  const profile = openAccountProfile(basePaths, mainLanguage())
  const paths = profile.paths
  ensureDirs(paths)
  seedProfileSecrets(basePaths, paths, safeStorage)
  logger = openLogger(paths)
  if (reset.applied) logger.warn('local data wiped on request', { removed: reset.removed, failed: reset.failed })
  process.on('uncaughtException', (e) => logger.error('uncaughtException', e))
  process.on('unhandledRejection', (e) => logger.error('unhandledRejection', e))
  logger.info('starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    packaged: app.isPackaged,
    smoke: SMOKE,
    dataRoot: paths.dataRoot,
  })

  const appIcon = app.isPackaged ? join(here, '..', 'dist', 'app-icon.png') : join(here, '..', 'public', 'app-icon.png')
  const emit = createBroadcast()
  const broadcast: typeof emit = (channel, payload) => {
    if (!accountSession?.isSwitching()) emit(channel, payload)
  }
  // Created before the window: its getters read `windows` / `ctx` when a notice fires, not now.
  const notifier = createSystemNotifier({
    isSupported: notificationsSupported,
    isAppFocused,
    enabled: () => !accountSession?.isSwitching() && (ctx?.config.get().general.notifications.enabled ?? false),
    show: (request) => showNativeNotification(request, appIcon),
    reveal: () => windows?.ensure(),
    runCommand: (command, payload) => {
      if (!sendToActive('app:command', { command, payload })) logger.warn('notification command dropped', { command })
    },
    logger: (level, msg, meta) => logger[level](msg, meta),
  })
  app.on('will-quit', () => notifier.dispose())
  ctx = await createApp({
    paths,
    logger,
    broadcast,
    safeStorage,
    substrateHostEntry: join(here, 'substrateHost.js'),
    env: process.env,
    systemLocale: app.getLocale(),
    openExternal: (url) => shell.openExternal(url),
    attention: notifier.notify,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    privacyHost: createPrivacyHost(),
  })
  const context = ctx
  accountSession = createAccountSession({
    base: basePaths,
    profile,
    context,
    safeStorage,
    restart: () => {
      notifier.dispose()
      windows?.get()?.destroy()
      relaunch()
    },
  })

  registerMediaProtocol({
    protocol: session.fromPartition(`persist:account-${paths.accountScope}`).protocol,
    allowList: context.allowList,
    logger,
    readOnly: createWeChatVideoAccess(() => {
      const account = context.substrate.status().account
      return account ? (resolveAccountDir(account.dbRoot, account.wxid) ?? undefined) : undefined
    }),
  })

  applyTheme(context.config.get())
  context.config.subscribe(applyTheme)
  // 设置 › 常规 › 开机自启 → the OS login item (packaged builds only).
  applyLoginItem(app, process.platform, context.config.get().general.launchAtLogin)
  context.config.subscribe((next, prev) => {
    if (next.general.launchAtLogin !== prev.general.launchAtLogin)
      applyLoginItem(app, process.platform, next.general.launchAtLogin)
  })
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} ${APP_NAME}`,
  })

  const smoke = SMOKE ? startSmoke() : undefined
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)
  // "Keep running after the window closes" hides the window: outside macOS only a tray icon can bring it back.
  const tray = createTrayController({
    platform: process.platform,
    tooltip: APP_NAME,
    labels: () => ({ show: t('main.tray.show', { name: APP_NAME }), quit: t('main.tray.quit') }),
    show: () => windows?.ensure(),
    quit: () => app.quit(),
    createTray: () =>
      new Tray(nativeImage.createFromPath(appIcon).resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })),
    buildMenu: (template) => Menu.buildFromTemplate(template),
  })
  app.on('will-quit', () => tray.dispose())
  windows = createWindowManager({
    paths,
    config: context.config,
    logger,
    preload: join(here, 'preload.cjs'),
    rendererIndex: join(here, '..', 'dist', 'index.html'),
    devServerUrl,
    isPackaged: app.isPackaged,
    appIcon,
    isQuitting: () => quitting,
    onCloseRequested: (win: BrowserWindow) => win.webContents.send('app:closeRequested', { reason: 'window_close' }),
    onBeforeHide: () => tray.ensure(),
    requestQuit: () => app.quit(),
    // Without this a broken preload leaves the renderer on its mock bridge and the smoke run only
    // dies of the 15 s timeout, with nothing in the log saying why.
    onRendererFault: (fault) => smoke?.finish(1, fault.detail),
  })
  const wm = windows

  const host: HostBridge = {
    accountSession,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    getMainWindow: () => wm.get(),
    isTrustedSender: (sender) => wm.isTrustedSender(sender),
    hideMainWindow: () => {
      tray.ensure()
      wm.hide()
    },
    quit: () => app.quit(),
    relaunch,
    onGetInfo: smoke ? () => smoke.finish(0, 'renderer invoked app:getInfo') : undefined,
  }
  registerIpc(context, host)

  const menuDeps: MenuDeps = {
    isMac: process.platform === 'darwin',
    isPackaged: app.isPackaged,
    appName: APP_NAME,
    send: (command, payload) => {
      if (!sendToActive('app:command', { command, payload }))
        logger.warn('menu command dropped: no window', { command })
    },
    openDataDir: () => void shell.openPath(paths.dataRoot),
    exportLogs: () => exportLogsFromMenu(context, paths),
  }
  installApplicationMenu(menuDeps)
  // Native menu labels are baked in when the menu is built: rebuild it when the UI language changes.
  let menuLanguage = mainLanguage()
  context.config.subscribe((next) => {
    if (next.general.language === menuLanguage) return
    menuLanguage = next.general.language
    installApplicationMenu(menuDeps)
    tray.refresh()
  })

  wm.create()
  app.on('activate', () => wm.ensure())
  logger.info('ready')
}

/** Quit and start again (account switch, 清除全部数据); devRelaunch.ts explains the dev-server path. */
function relaunch(): void {
  if (relaunchesThroughDevServer(process.env, app.isPackaged)) devRelaunchOnExit = true
  else app.relaunch()
  app.quit()
}

function applyTheme(cfg: AppConfig): void {
  nativeTheme.themeSource = cfg.general.theme
}

function exportLogsFromMenu(context: AppContext, paths: AppPaths): void {
  try {
    const out = exportDiagnostics({
      appVersion: app.getVersion(),
      files: context.logger.files(),
      exportsDir: paths.exportsDir,
      redaction: diagnosticsRedaction(),
    })
    shell.showItemInFolder(out)
    context.toast({ kind: 'success', text: t('menu.logsExported') })
  } catch (e) {
    logger.error('export logs failed', e)
    context.toast({ kind: 'error', text: t('menu.exportLogsFailed') })
  }
}

interface SmokeRun {
  /** First call wins; later calls (timeout, a fault after success) are ignored. */
  finish(code: number, reason: string): void
}

function startSmoke(): SmokeRun {
  let finished = false
  const timer = setTimeout(() => finish(1, 'timeout waiting for app:getInfo'), SMOKE_TIMEOUT_MS)
  function finish(code: number, reason: string): void {
    if (finished) return
    finished = true
    clearTimeout(timer)
    logger.info(`smoke finished: ${reason}`, { code })
    void gracefulQuit(code)
  }
  return { finish }
}

/**
 * `--smoke` could not even start (before 'ready', so nothing is composed yet). Write the reason to
 * main.log and stderr, then exit 1 — quitting silently here is exactly the false positive we avoid.
 */
function abortSmokeBeforeReady(reason: string): void {
  try {
    const paths = buildPaths()
    ensureDirs(paths)
    logger = openLogger(paths)
  } catch (e) {
    // No log file exists yet: stderr is the only place a failing --smoke run can report to.
    // eslint-disable-next-line no-console
    console.error('[aiwc --smoke] cannot open main.log:', e)
  }
  // eslint-disable-next-line no-console
  if (logger === nullLogger) console.error(`[aiwc --smoke] smoke aborted: ${reason}`)
  logger.error(`smoke aborted: ${reason}`, { code: 1 })
  app.exit(1)
}

async function gracefulQuit(code: number): Promise<void> {
  if (shutdownDone) return
  quitting = true
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))
  try {
    await Promise.race([ctx?.shutdown() ?? Promise.resolve(), timeout])
  } catch (e) {
    logger.error('shutdown error', e)
  }
  shutdownDone = true
  logger.info('exit', { code, devRelaunch: devRelaunchOnExit })
  if (devRelaunchOnExit) app.exit(DEV_RELAUNCH_EXIT_CODE)
  else if (SMOKE || code !== 0) app.exit(code)
  else app.quit()
}

function fatal(title: string, e: unknown): void {
  const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
  logger.error(title, e)
  try {
    dialog.showErrorBox(`AIWC ${title}`, message)
  } catch {
    // no display (smoke on CI)
  }
  app.exit(1)
}
