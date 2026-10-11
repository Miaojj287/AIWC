import { AccountTargetSchema, validateWechatKey, type WxSession } from '@aiwc/protocol'
import {
  acquireKeys,
  detectWeChat,
  findWeChatPidSync,
  listAccounts,
  scanMacDbKey,
  scanMacDbKeyFromDumps,
  verifyAccount,
} from '@aiwc/substrate'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import { createRelaunchCapture } from '../wechat/relaunchCapture'
import { createWeChatControl } from '../wechat/wechatProcess'
import { createAccountActivator } from '../substrate/activateAccount'
import { SECRET_REFS } from '../config/secretStore'
import type { AppContext } from '../contracts'
import {
  buildSessionExport,
  collectSessionExportMessages,
  parseSessionExportRequest,
  writeExport,
} from '../services/exporter'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

const KEY_REF_BY_KIND = {
  db_key: { ref: SECRET_REFS.dbKey, field: 'dbKeyRef' },
  image_xor: { ref: SECRET_REFS.imageXorKey, field: 'imageXorKeyRef' },
  image_aes: { ref: SECRET_REFS.imageAesKey, field: 'imageAesKeyRef' },
} as const

/** pinned first, then newest activity — after local flags have been applied. */
export function sortSessions(items: WxSession[]): WxSession[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}

export function registerSubstrateIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:substrate')
  const { substrate, config } = ctx
  const credentials = (target?: { wxid: string; dbRoot: string }) =>
    host.accountSession?.credentials(target ? AccountTargetSchema.parse(target) : undefined) ?? ctx

  const currentDbRoot = async (override?: string): Promise<string> => {
    const fromCfg = override ?? config.get().account.dbRoot
    if (fromCfg) return fromCfg
    const detected = await detectWeChat()
    if (detected.dbRoot) return detected.dbRoot
    throw new Error(t('main.substrate.noDataDir'))
  }

  const storeKey = (kind: keyof typeof KEY_REF_BY_KIND, hex: string, target?: { wxid: string; dbRoot: string }) => {
    const { config, secrets } = credentials(target)
    const { ref, field } = KEY_REF_BY_KIND[kind]
    secrets.set(ref, hex)
    config.set({ account: { [field]: ref } })
  }

  handle('substrate:status', () => substrate.status())

  handle('substrate:detectWeChat', async () => {
    const r = await detectWeChat()
    return { running: r.running, dbRoot: r.dbRoot, version: r.version }
  })

  handle('substrate:listAccounts', async ({ dbRoot }) => {
    const accounts = await listAccounts(await currentDbRoot(dbRoot))
    const status = substrate.status()
    if (status.connection !== 'ready') return accounts
    return accounts.map((account) => {
      const active = status.account
      return active?.wxid === account.wxid && active.dbRoot === account.dbRoot ? { ...account, ...active } : account
    })
  })

  handle('substrate:verifyAccount', async (raw) => {
    const { wxid, dbRoot } = AccountTargetSchema.parse(raw)
    const { config, secrets } = credentials({ wxid, dbRoot })
    const ref = config.get().account.dbKeyRef
    const dbKeyHex = ref ? (secrets.reveal(ref) ?? undefined) : undefined
    const r = await verifyAccount({ dbRoot, wxid, dbKeyHex })
    return r
  })

  // One acquisition at a time: a new request (or 取消) aborts the running one and waits it out, so two
  // runs never fight over WeChat or the helper processes, and a stale run cannot store keys later.
  let inflight: { controller: AbortController; done: Promise<unknown> } | undefined

  handle('substrate:cancelAcquireKeys', () => {
    inflight?.controller.abort()
  })

  handle('substrate:acquireKeys', async (req) => {
    const { wxid, dbRoot } = AccountTargetSchema.parse({ wxid: req?.wxid, dbRoot: req?.dbRoot })
    if (typeof wxid !== 'string' || !wxid || typeof dbRoot !== 'string' || !dbRoot)
      throw new Error(t('main.substrate.selectDbRootAndAccount'))
    const strategy = req.strategy === 'memory_scan' ? 'memory_scan' : 'auto'
    const scope = req.scope === 'image' ? 'image' : 'all'
    if (inflight) {
      inflight.controller.abort()
      await inflight.done.catch(() => undefined)
    }
    const controller = new AbortController()
    const run = runAcquire(wxid, dbRoot, strategy, scope, controller.signal)
    inflight = { controller, done: run }
    try {
      return await run
    } finally {
      if (inflight?.controller === controller) inflight = undefined
    }
  })

  const runAcquire = async (
    wxid: string,
    dbRoot: string,
    strategy: 'auto' | 'memory_scan',
    scope: 'all' | 'image',
    signal: AbortSignal,
  ) => {
    const wechat = createWeChatControl()
    // If the user quits WeChat while we wait for a login (instead of logging out), bring it back.
    const wasRunning = process.platform === 'darwin' && wechat.isRunning()
    const relaunchCapture = createRelaunchCapture({
      control: wechat,
      scanLive: (pid, db, ms, sig) => scanMacDbKey(pid, db, ctx.paths.nativeDir, ms, sig),
      scanDumps: (db, ms, sig) => scanMacDbKeyFromDumps(db, ctx.paths.nativeDir, ms, sig),
      findPid: findWeChatPidSync,
      logger: ctx.logger,
    })
    const result = await acquireKeys({
      dbRoot,
      wxid,
      strategy,
      scope,
      nativeDir: ctx.paths.nativeDir,
      // Each transition goes to the renderer so the wizard / settings panel can show the stage inline.
      onStep: (step) => ctx.broadcast('substrate:keyStep', step),
      relaunchCapture,
      signal,
    })
    if (wasRunning && !wechat.isRunning() && !(await wechat.ensureRunning()))
      log.warn('WeChat is not running after key acquisition')
    // A cancelled run stores nothing: the user has moved on and may already be running another one.
    if (result.cancelled || signal.aborted) return result.steps
    if (result.dbKeyHex) storeKey('db_key', result.dbKeyHex, { wxid, dbRoot })
    if (result.imageXorHex) storeKey('image_xor', result.imageXorHex, { wxid, dbRoot })
    if (result.imageAesHex) storeKey('image_aes', result.imageAesHex, { wxid, dbRoot })
    if (result.dbKeyHex) credentials({ wxid, dbRoot }).config.set({ account: { wxid, dbRoot } })
    const imagesComplete = Boolean(result.imageXorHex && result.imageAesHex)
    const complete = imagesComplete && (scope === 'image' || Boolean(result.dbKeyHex))
    ctx.toast({
      id: 'substrate.acquireKeys',
      kind: complete ? 'success' : scope === 'all' && result.dbKeyHex ? 'info' : 'warning',
      text: complete
        ? t('main.substrate.keysAcquired')
        : scope === 'image'
          ? t('main.substrate.imageKeysAcquireFailed')
          : result.dbKeyHex
            ? t('main.substrate.keysAcquiredPartial')
            : t('main.substrate.keysAcquireFailed'),
    })
    return result.steps
  }

  handle('substrate:setManualKey', ({ kind, hex, target }) => {
    const v = validateWechatKey(kind, hex)
    if (!v.ok) return v
    storeKey(kind, v.hex, target)
    if (kind === 'db_key') credentials(target).config.set({ account: { verifiedAt: 0 } })
    return { ok: true }
  })

  handle('substrate:testConnection', async (target) => {
    const { config, secrets } = credentials(target || undefined)
    const a = { ...config.get().account, ...target }
    if (!a.dbRoot || !a.wxid) return { ok: false, error: t('main.substrate.selectDbRootAndAccount') }
    const dbKeyHex = a.dbKeyRef ? (secrets.reveal(a.dbKeyRef) ?? undefined) : undefined
    if (!dbKeyHex) return { ok: false, error: t('main.substrate.dbKeyMissing') }
    return verifyAccount({ dbRoot: a.dbRoot, wxid: a.wxid, dbKeyHex })
  })

  const activate = createAccountActivator(ctx, host.accountSession, ctx.paths.accountScope)
  handle('substrate:connect', async (target) => {
    if (inflight) {
      inflight.controller.abort()
      await inflight.done.catch((error: unknown) =>
        log.debug('key acquisition cancelled before account activation', { error: String(error) }),
      )
    }
    const selected = target ? AccountTargetSchema.parse(target) : undefined
    const cache = customCacheDir(selected?.cacheDir)
    if (cache) {
      const verdict = validateCacheDir(cache, { allowList: ctx.allowList })
      if (!verdict.ok) throw new Error(verdict.reason)
    }
    return activate(selected)
  })
  handle('substrate:sync', (o) => substrate.sync(o))

  handle('substrate:listSessions', async (q) => {
    const r = await substrate.listSessions(q)
    return { ...r, items: sortSessions(r.items) }
  })
  handle('substrate:getSession', ({ id }) => substrate.getSession(id))
  handle('substrate:listMessages', (q) => substrate.listMessages(q))
  handle('substrate:getMessage', ({ sessionId, messageId }) => substrate.getMessage(sessionId, messageId))
  handle('substrate:getContext', ({ anchor, radius }) => substrate.getContext(anchor, radius))
  handle('substrate:search', (q) => substrate.search(q))
  handle('substrate:listContacts', (q) => substrate.listContacts(q))
  handle('substrate:listGroupMembers', ({ groupId, ...page }) => substrate.listGroupMembers(groupId, page))
  handle('substrate:stats', (q) => substrate.stats(q))
  handle('substrate:resolveMedia', ({ sessionId, messageId }) => substrate.resolveMedia(sessionId, messageId))
  handle('substrate:transcribeVoice', ({ sessionId, messageId, force }) =>
    substrate.transcribeVoice!(sessionId, messageId, { force }),
  )

  // Flags / index maintenance live in the mirror (SubstrateExtras served by the utility process).
  handle('substrate:setSessionFlags', async ({ sessionId, ...flags }) => {
    await substrate.setSessionFlags(sessionId, flags)
  })
  handle('substrate:removeIndex', ({ sessionId }) => substrate.removeIndex(sessionId))
  handle('substrate:rebuildIndex', ({ sessionId }) => substrate.rebuildIndex(sessionId))

  handle('substrate:export', async (raw) => {
    const parsed = parseSessionExportRequest(raw)
    if (!parsed.ok) {
      log.warn('rejected malformed substrate:export request', { where: parsed.where })
      throw new Error(t('main.ipc.operationFailed'))
    }
    const { sessionId, format, outDir } = parsed.request
    const session = (await substrate.getSession(sessionId)) ?? { id: sessionId, title: sessionId, kind: 'dm' as const }
    const messages = await collectSessionExportMessages((q) => substrate.listMessages(q), parsed.request)
    const dir = outDir && ctx.allowList.isAllowed(outDir) ? outDir : ctx.paths.exportsDir
    if (outDir && dir !== outDir) log.warn('export outDir not in allow-list; using exports dir', { outDir })
    const { content, ext } = buildSessionExport(format, session, messages)
    const path = writeExport(dir, session.title, ext, content)
    ctx.toast({
      kind: 'success',
      text: t('main.substrate.exported', { n: messages.length }),
      action: { label: t('main.substrate.openLocation'), command: 'tab.openFile' },
    })
    return { path }
  })
}
