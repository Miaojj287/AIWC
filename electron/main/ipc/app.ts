import { basename } from 'node:path'
import { dialog, shell } from 'electron'
import type { AppContext } from '../contracts'
import { resolveAllowedExisting } from '../security/pathAllowList'
import { diagnosticsRedaction, exportDiagnostics } from '../services/diagnostics'
import { currentSystemVersion, supportsTransparency } from '../windows/transparency'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

/** Schemes `app:openUrl` will hand to the OS: web links, mail, and the macOS / Windows settings deep links. */
const EXTERNAL_URL = /^(?:https?|mailto|x-apple\.systempreferences|ms-settings):/i

export function registerAppIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:app')

  handle('app:windowControl', ({ action }) => {
    const win = host.getMainWindow()
    if (!win || win.isDestroyed()) return
    switch (action) {
      // Go through the existing close event so the user's close preference still applies.
      case 'close':
        win.close()
        break
      case 'minimize':
        win.minimize()
        break
      case 'fullscreen':
        win.setFullScreen(!win.isFullScreen())
        break
      case 'zoom':
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
      default:
        throw new Error(t('main.app.unknownWindowAction'))
    }
  })

  handle('app:getInfo', () => {
    host.onGetInfo?.()
    return {
      version: host.appVersion,
      platform: process.platform as 'darwin' | 'win32' | 'linux',
      dataDir: ctx.paths.dataRoot,
      isPackaged: host.isPackaged,
      transparency: supportsTransparency(process.platform, currentSystemVersion()),
    }
  })

  // app:checkUpdate lives with the updater in ./data.ts.

  handle('app:exportLogs', () => {
    const out = exportDiagnostics({
      appVersion: host.appVersion,
      files: ctx.logger.files(),
      exportsDir: ctx.paths.exportsDir,
      redaction: diagnosticsRedaction(),
    })
    log.info('logs exported', { file: basename(out) })
    return { path: out }
  })

  handle('app:openPath', async ({ path }) => {
    // Same rule as file:*: the real path (symlinks resolved) must also be inside the allow-list.
    const real = await resolveAllowedExisting(ctx.allowList, path)
    const err = await shell.openPath(real)
    if (err) throw new Error(err)
  })

  /**
   * Links and OS deep links. Kept apart from app:openPath (which resolves a real file against the
   * allow-list and therefore rejects every URL): before this existed, clicking a link in a message or
   * 打开系统设置 in onboarding silently did nothing.
   */
  handle('app:openUrl', async ({ url }) => {
    const target = url.trim()
    if (!EXTERNAL_URL.test(target)) throw new Error(t('main.app.unsupportedUrl'))
    await shell.openExternal(target)
  })

  handle('app:pickDirectory', async ({ title, defaultPath }) => {
    const win = host.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: title ?? t('main.app.pickFolderTitle'),
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: t('main.app.pickFolderButton'),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (!picked) return null
    // The dialog result is the one renderer-initiated source trusted to widen the allow-list.
    if (!ctx.allowList.addRoot(picked))
      log.warn('picked directory not added to allow-list (filesystem root or home)', { picked })
    return picked
  })

  handle('app:setCloseBehaviorOnce', ({ behavior, remember }) => {
    if (remember) ctx.config.set({ general: { closeBehavior: behavior } })
    if (behavior === 'quit') host.quit()
    else host.hideMainWindow()
  })
}
