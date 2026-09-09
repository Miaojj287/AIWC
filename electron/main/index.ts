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
import { app, dialog, nativeTheme, safeStorage, shell, type BrowserWindow } from 'electron'
import type { AppConfig } from '@aiwc/protocol'
import { createPaths, ensureDirs, type AppPaths } from './paths'
import { createLogger, nullLogger, type Logger } from './log'
import { createBroadcast, sendToActive } from './broadcast'
import { createApp } from './composition'
import type { AppContext } from './contracts'
import { registerMediaProtocol, registerMediaScheme } from './protocols/mediaProtocol'
import { createWindowManager, type WindowManager } from './windows/mainWindow'
import { installApplicationMenu } from './menu'
import { registerIpc, type HostBridge } from './ipc/register'
import { formatDateForFile } from './services/exporter'
import { readFileSync, writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url)) // dist-electron/
const SMOKE = process.argv.includes('--smoke')
const SMOKE_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 8_000
const APP_NAME = 'AIWC'

// In development Electron otherwise exposes its own bundle name in the macOS Dock and app menu.
// Packaged builds also set this from productName, but keeping it explicit makes every launch path
// present the same product identity.
app.setName(APP_NAME)

let logger: Logger = nullLogger
let ctx: AppContext | undefined
let windows: WindowManager | undefined
let quitting = false
let shutdownDone = false

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
    .catch((e: unknown) => fatal('启动失败', e))
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
  return createLogger({ file: paths.mainLogFile, level: app.isPackaged ? 'info' : 'debug', maxBytes: 2 * 1024 * 1024, maxFiles: 5 })
}

async function bootstrap(): Promise<void> {
  const paths = buildPaths()
  ensureDirs(paths)
  logger = openLogger(paths)
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

  const broadcast = createBroadcast()
  ctx = await createApp({
    paths,
    logger,
    broadcast,
    safeStorage,
    substrateHostEntry: join(here, 'substrateHost.js'),
    env: process.env,
  })
  const context = ctx

  registerMediaProtocol({ allowList: context.allowList, logger })

  applyTheme(context.config.get())
  context.config.subscribe(applyTheme)

  const smoke = SMOKE ? startSmoke() : undefined
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const appIcon = app.isPackaged ? join(here, '..', 'dist', 'app-icon.png') : join(here, '..', 'public', 'app-icon.png')
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)
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
    requestQuit: () => app.quit(),
    // Without this a broken preload leaves the renderer on its mock bridge and the smoke run only
    // dies of the 15 s timeout, with nothing in the log saying why.
    onRendererFault: (fault) => smoke?.finish(1, fault.detail),
  })
  const wm = windows

  const host: HostBridge = {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    getMainWindow: () => wm.get(),
    isTrustedSender: (sender) => wm.isTrustedSender(sender),
    hideMainWindow: () => wm.hide(),
    quit: () => app.quit(),
    onGetInfo: smoke ? () => smoke.finish(0, 'renderer invoked app:getInfo') : undefined,
  }
  registerIpc(context, host)

  installApplicationMenu({
    isMac: process.platform === 'darwin',
    isPackaged: app.isPackaged,
    appName: APP_NAME,
    send: (command, payload) => {
      if (!sendToActive('app:command', { command, payload })) logger.warn('menu command dropped: no window', { command })
    },
    openDataDir: () => void shell.openPath(paths.dataRoot),
    exportLogs: () => exportLogsFromMenu(context, paths),
  })

  wm.create()
  app.on('activate', () => wm.ensure())
  logger.info('ready')
}

function applyTheme(cfg: AppConfig): void {
  nativeTheme.themeSource = cfg.general.theme
}

function exportLogsFromMenu(context: AppContext, paths: AppPaths): void {
  try {
    const files = [...context.logger.files()].reverse()
    const out = join(paths.exportsDir, `aiwc-logs-${formatDateForFile()}.log`)
    writeFileSync(out, files.map((f) => `\n===== ${f} =====\n${readFileSync(f, 'utf8')}`).join(''), 'utf8')
    shell.showItemInFolder(out)
    context.toast({ kind: 'success', text: '日志已导出' })
  } catch (e) {
    logger.error('export logs failed', e)
    context.toast({ kind: 'error', text: '导出日志失败' })
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
    console.error('[aiwc --smoke] cannot open main.log:', e)
  }
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
  logger.info('exit', { code })
  if (SMOKE || code !== 0) app.exit(code)
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
