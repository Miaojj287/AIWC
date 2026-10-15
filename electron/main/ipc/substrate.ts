import {
  AccountTargetSchema,
  WechatManualKeyRequestSchema,
  WechatClearKeyRequestSchema,
  validateWechatKey,
  type WxSession,
} from '@aiwc/protocol'
import { detectWeChat, listAccounts } from '@aiwc/substrate'
import { createWechatConnection, registerWechatConnection } from './wechatConnection'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
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

  const connection = createWechatConnection(ctx, host)
  registerWechatConnection(handle, connection)

  const refreshCredentials = async (saved: ReturnType<typeof credentials>) => {
    if (saved.config === ctx.config && substrate.status().connection === 'ready') {
      const result = await substrate.reconnect()
      if (!result.ok) throw new Error(result.error ?? t('main.substrate.connectFailed'))
    }
  }
  handle('substrate:setManualKey', async (raw) => {
    const { kind, hex, target } = WechatManualKeyRequestSchema.parse(raw)
    const v = validateWechatKey(kind, hex)
    if (!v.ok) return v
    await connection.settle()
    const saved = credentials(target)
    const { ref, field } = KEY_REF_BY_KIND[kind]
    const account = saved.config.get().account
    saved.secrets.set(ref, v.hex)
    saved.config.set({
      account: {
        [field]: ref,
        credentialRevision: (account.credentialRevision ?? 0) + 1,
        ...(kind === 'db_key' ? { verifiedAt: 0, dbCredentialsRef: null } : {}),
      },
    })
    if (kind === 'db_key') saved.secrets.delete(SECRET_REFS.dbCredentials)
    await refreshCredentials(saved)
    return { ok: true }
  })
  handle('substrate:clearKey', async (raw) => {
    const { kind, target } = WechatClearKeyRequestSchema.parse(raw)
    await connection.settle()
    const saved = credentials(target)
    const { config, secrets } = saved
    const { ref, field } = KEY_REF_BY_KIND[kind]
    const account = config.get().account
    if (kind === 'db_key' && saved.config === ctx.config) await substrate.close()
    for (const value of new Set([ref, account[field]])) if (value) secrets.delete(value)
    if (kind === 'db_key') secrets.delete(SECRET_REFS.dbCredentials)
    config.set({
      account: {
        [field]: null,
        credentialRevision: (account.credentialRevision ?? 0) + 1,
        ...(kind === 'db_key' ? { verifiedAt: 0, dbCredentialsRef: null } : {}),
      },
    })
    if (kind !== 'db_key') await refreshCredentials(saved)
  })

  const activate = createAccountActivator(ctx, host.accountSession, ctx.paths.accountScope, connection.verify)
  handle('substrate:connect', async (target) => {
    await connection.settle()
    const selected = target ? AccountTargetSchema.parse(target) : undefined
    const cache = customCacheDir(selected?.cacheDir)
    if (cache) {
      const saved = customCacheDir(config.get().account.cacheDir)
      const verdict = validateCacheDir(cache, { allowList: ctx.allowList, saved })
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
