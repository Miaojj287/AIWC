import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, shell } from 'electron'
import type { AppContext } from '../contracts'
import { resolveAllowedExisting } from '../security/pathAllowList'
import { formatDateForFile } from '../services/exporter'
import type { Handle, HostBridge } from './register'

/** Schemes `app:openUrl` will hand to the OS: web links, mail, and the macOS / Windows settings deep links. */
const EXTERNAL_URL = /^(?:https?|mailto|x-apple\.systempreferences|ms-settings):/i

export function registerAppIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:app')

  handle('app:getInfo', () => {
    host.onGetInfo?.()
    return {
      version: host.appVersion,
      platform: process.platform as 'darwin' | 'win32' | 'linux',
      dataDir: ctx.paths.dataRoot,
      isPackaged: host.isPackaged,
    }
  })

  handle('app:checkUpdate', () => {
    // TODO: wire electron-updater (autoUpdater.checkForUpdates → 'app:update' events). Until then the
    // settings page shows "已是最新".
    return { state: 'up_to_date', version: host.appVersion }
  })

  handle('app:exportLogs', () => {
    const files = [...ctx.logger.files()].reverse() // oldest first
    const out = join(ctx.paths.exportsDir, `aiwc-logs-${formatDateForFile()}.log`)
    const chunks: string[] = [`# AIWC ${host.appVersion} · ${process.platform}-${process.arch} · electron ${process.versions.electron ?? '?'}\n`]
    for (const f of files) {
      try {
        chunks.push(`\n===== ${f} =====\n`, readFileSync(f, 'utf8'))
      } catch (e) {
        chunks.push(`\n===== ${f} (读取失败: ${e instanceof Error ? e.message : String(e)}) =====\n`)
      }
    }
    writeFileSync(out, chunks.join(''), 'utf8')
    log.info('logs exported', { out })
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
    if (!EXTERNAL_URL.test(target)) throw new Error('只能打开 http / https / mailto 链接或系统设置')
    await shell.openExternal(target)
  })

  handle('app:pickDirectory', async ({ title, defaultPath }) => {
    const win = host.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: title ?? '选择文件夹',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (!picked) return null
    // The dialog result is the one renderer-initiated source trusted to widen the allow-list.
    if (!ctx.allowList.addRoot(picked)) log.warn('picked directory not added to allow-list (filesystem root or home)', { picked })
    return picked
  })

  handle('app:setCloseBehaviorOnce', ({ behavior, remember }) => {
    if (remember) ctx.config.set({ general: { closeBehavior: behavior } })
    if (behavior === 'quit') host.quit()
    else host.hideMainWindow()
  })
}
