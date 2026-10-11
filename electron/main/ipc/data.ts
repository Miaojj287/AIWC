/**
 * storage:* (设置 › 数据), file:previewDocument / file:stageChatFile (文件 Tab previews) and update:* +
 * app:checkUpdate (设置 › 关于). Inputs are validated here; locations always come from AppPaths and the
 * substrate, never from the renderer.
 */
import { existsSync, readdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, session } from 'electron'
import { z } from 'zod'
import { CLEARABLE_STORAGE_CATEGORIES, type InvokeReq, type UpdateUnavailableReason } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import { resolveAllowedExisting } from '../security/pathAllowList'
import { stageChatFile } from '../services/chatFileStage'
import { substrateCacheDir } from '../paths'
import { scheduleDataReset } from '../services/dataReset'
import { previewDocx } from '../services/preview/docxPreview'
import { previewXlsx } from '../services/preview/xlsxPreview'
import { clearStorage, measureStorage, previewStageDir } from '../services/storage'
import { BACKGROUND_CHECK_DELAY_MS, createUpdater, type AutoUpdaterLike } from '../services/updater'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

/** Largest Office file parsed for preview. */
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
/** Longest session / message id accepted from the renderer. */
const MAX_ID_CHARS = 512

const clearSchema = z.strictObject({ category: z.enum(CLEARABLE_STORAGE_CATEGORIES) }) satisfies z.ZodType<
  InvokeReq<'storage:clear'>
>
const pathSchema = z.strictObject({ path: z.string().min(1).max(4096) })
const stageSchema = z.strictObject({
  sessionId: z.string().min(1).max(MAX_ID_CHARS),
  messageId: z.string().min(1).max(MAX_ID_CHARS),
}) satisfies z.ZodType<InvokeReq<'file:stageChatFile'>>

const UNAVAILABLE_KEYS = {
  dev_build: 'main.data.update.devBuild',
  no_feed: 'main.data.update.noFeed',
  unsupported_platform: 'main.data.update.unsupportedPlatform',
} as const satisfies Record<UpdateUnavailableReason, string>

export function registerDataIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:data')
  const parse = <T>(schema: z.ZodType<T>, raw: unknown, channel: string): T => {
    const parsed = schema.safeParse(raw)
    if (parsed.success) return parsed.data
    log.warn(`rejected malformed ${channel} request`, { where: parsed.error.issues[0]?.path.join('.') })
    throw new Error(t('main.ipc.operationFailed'))
  }
  /** The validated custom WeChat cache folder (same policy composition.ts applies), if any. */
  const cacheOverride = (): string | undefined => {
    const raw = customCacheDir(ctx.config.get().account.cacheDir)
    if (!raw) return undefined
    const verdict = validateCacheDir(raw)
    return verdict.ok ? substrateCacheDir(ctx.paths, verdict.dir) : undefined
  }

  // ---- 本地数据 --------------------------------------------------------------------------------
  let clearing = false
  handle('storage:usage', () => measureStorage(ctx.paths, cacheOverride()))

  handle('storage:clear', async (raw) => {
    const { category } = parse(clearSchema, raw, 'storage:clear')
    if (clearing) throw new Error(t('main.data.clearBusy'))
    clearing = true
    try {
      const freedBytes = await clearStorage(category, {
        paths: ctx.paths,
        cacheOverride,
        substrate: ctx.substrate,
      })
      log.info('storage cleared', { category, freedBytes })
      return { freedBytes }
    } finally {
      clearing = false
    }
  })

  handle('storage:wipeAll', async () => {
    // The custom cache dir's owned folders are derived from the saved config when the wipe is applied.
    scheduleDataReset(ctx.paths.applicationDataRoot ?? ctx.paths.dataRoot)
    log.warn('all local data scheduled for deletion; relaunching')
    // Renderer storage (remembered theme, layout) lives outside the data root.
    const profiles = ctx.paths.applicationDataRoot ? join(ctx.paths.applicationDataRoot, 'accounts') : undefined
    const partitions = profiles ? readdirSync(profiles).filter((name) => /^(?:[a-f0-9]{64}|unbound)$/.test(name)) : []
    await Promise.all(
      [session.defaultSession, ...partitions.map((id) => session.fromPartition(`persist:account-${id}`))].map((store) =>
        store.clearStorageData(),
      ),
    )
    host.relaunch()
  })

  // ---- 文件预览 ------------------------------------------------------------------------------
  handle('file:previewDocument', async (raw) => {
    const { path } = parse(pathSchema, raw, 'file:previewDocument')
    const real = await resolveAllowedExisting(ctx.allowList, path)
    const st = await stat(real)
    if (!st.isFile()) throw new Error(t('main.files.notAFile'))
    if (st.size > MAX_DOCUMENT_BYTES)
      throw new Error(t('main.files.tooLarge', { mb: MAX_DOCUMENT_BYTES / 1024 / 1024 }))
    const lower = real.toLowerCase()
    const file = await readFile(real)
    if (lower.endsWith('.docx')) return previewDocx(file)
    if (lower.endsWith('.xlsx')) return previewXlsx(file)
    throw new Error(t('main.data.previewUnsupported'))
  })

  handle('file:stageChatFile', async (raw) => {
    const { sessionId, messageId } = parse(stageSchema, raw, 'file:stageChatFile')
    return stageChatFile(
      {
        resolveMedia: (s, m) => ctx.substrate.resolveMedia(s, m),
        accountRoot: () => ctx.config.get().account.dbRoot,
        stageDir: previewStageDir(ctx.paths),
        isAllowed: (p) => ctx.allowList.isAllowed(p),
      },
      sessionId,
      messageId,
    )
  })

  // ---- 自动更新 ------------------------------------------------------------------------------
  const updater = createUpdater({
    isPackaged: host.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    hasFeed: () => existsSync(join(process.resourcesPath ?? '', 'app-update.yml')),
    appVersion: host.appVersion,
    load: async () => {
      // CommonJS package: its exports arrive on `default` when imported from ESM.
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: AutoUpdaterLike
        default?: { autoUpdater: AutoUpdaterLike }
      }
      const u = mod.autoUpdater ?? mod.default?.autoUpdater
      if (!u) throw new Error(t('main.data.update.loadFailed'))
      return u
    },
    emit: (status) => ctx.broadcast('app:update', status),
    onBackgroundAvailable: (version) =>
      ctx.toast({
        kind: 'info',
        text: t('main.data.update.availableToast', { version }),
        action: { label: t('main.data.update.view'), command: 'tab.openSettings', payload: { page: 'about' } },
      }),
    logger: ctx.logger.child('updater'),
    unavailableError: (reason) => new Error(t(UNAVAILABLE_KEYS[reason])),
    stateError: (what) =>
      new Error(t(what === 'download' ? 'main.data.update.nothingToDownload' : 'main.data.update.notReady')),
    timeoutError: () => new Error(t('main.data.update.timeout')),
  })

  handle('app:checkUpdate', () => updater.check())
  handle('update:getState', () => updater.state())
  handle('update:download', () => updater.download())
  handle('update:install', () => updater.install())

  if (!updater.state().unavailable) {
    const timer = setTimeout(() => {
      void updater.check({ background: true }).catch((e: unknown) => log.warn('background update check failed', e))
    }, BACKGROUND_CHECK_DELAY_MS)
    app.once('will-quit', () => clearTimeout(timer))
  }
}
