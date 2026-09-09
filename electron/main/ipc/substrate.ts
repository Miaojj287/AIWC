import { validateWechatKey, type KeyAcquireStep, type WxMessage, type WxSession } from '@aiwc/protocol'
import { acquireKeys, detectWeChat, listAccounts, verifyAccount } from '@aiwc/substrate'
import { createRelaunchCapture } from '../wechat/relaunchCapture'
import { createAccountActivator } from '../substrate/activateAccount'
import { SECRET_REFS } from '../config/secretStore'
import type { AppContext } from '../contracts'
import { buildSessionExport, writeExport } from '../services/exporter'
import type { Handle, HostBridge } from './register'

const KEY_REF_BY_KIND = {
  db_key: { ref: SECRET_REFS.dbKey, field: 'dbKeyRef' },
  image_xor: { ref: SECRET_REFS.imageXorKey, field: 'imageXorKeyRef' },
  image_aes: { ref: SECRET_REFS.imageAesKey, field: 'imageAesKeyRef' },
} as const

const EXPORT_PAGE = 500
const EXPORT_MAX = 100_000

/** pinned first, then newest activity — after local flags have been applied. */
export function sortSessions(items: WxSession[]): WxSession[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  })
}

export function registerSubstrateIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:substrate')
  const { substrate, config, secrets } = ctx

  const currentDbRoot = async (override?: string): Promise<string> => {
    const fromCfg = override ?? config.get().account.dbRoot
    if (fromCfg) return fromCfg
    const detected = await detectWeChat()
    if (detected.dbRoot) return detected.dbRoot
    throw new Error('未找到微信数据目录，请先在「设置 › 账号」中选择')
  }

  const storeKey = (kind: keyof typeof KEY_REF_BY_KIND, hex: string) => {
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
    return Promise.all(accounts.map(async (account) => {
      const active = status.account
      if (active?.wxid === account.wxid && active.dbRoot === account.dbRoot) return { ...account, ...active }
      // Directory suffixes identify the local installation, not the contact's WeChat ID.
      const username = account.wxid.replace(/_[a-f0-9]{4,}$/i, '')
      try {
        const contact = await substrate.getContact(username)
        return contact ? { ...account, nickname: contact.nickname === username ? undefined : contact.nickname, avatarPath: contact.avatarPath } : account
      } catch {
        return account
      }
    }))
  })

  handle('substrate:verifyAccount', async ({ wxid, dbRoot }) => {
    const ref = config.get().account.dbKeyRef
    const dbKeyHex = ref ? secrets.reveal(ref) ?? undefined : undefined
    const r = await verifyAccount({ dbRoot, wxid, dbKeyHex })
    return r
  })

  handle('substrate:acquireKeys', async ({ wxid, dbRoot, strategy }) => {
    const steps = new Map<KeyAcquireStep['id'], KeyAcquireStep>()
    const onStep = (step: KeyAcquireStep) => {
      steps.set(step.id, step)
      // Push each step transition to the renderer so the wizard/settings panel can show progress
      // inline (below the keys), the way the reference app does — no separate progress dialog.
      ctx.broadcast('substrate:keyStep', step)
    }
    const relaunchCapture = createRelaunchCapture({
      nativeDir: ctx.paths.nativeDir,
      logger: ctx.logger,
      onStatus: (text) => ctx.broadcast('substrate:keyStep', { id: 'db_key', label: '获取数据库密钥', status: 'doing', detail: text }),
    })
    const result = await acquireKeys({ dbRoot, wxid, strategy: strategy ?? 'auto', nativeDir: ctx.paths.nativeDir, onStep, relaunchCapture })
    if (result.dbKeyHex) storeKey('db_key', result.dbKeyHex)
    if (result.imageXorHex) storeKey('image_xor', result.imageXorHex)
    if (result.imageAesHex) storeKey('image_aes', result.imageAesHex)
    if (result.dbKeyHex) config.set({ account: { wxid, dbRoot } })
    ctx.toast({ id: 'substrate.acquireKeys', kind: result.dbKeyHex ? 'success' : 'warning', text: result.dbKeyHex ? '密钥获取完成' : '未能自动获取数据库密钥，可尝试内存扫描或手动粘贴' })
    return result.steps.length ? result.steps : [...steps.values()]
  })

  handle('substrate:setManualKey', ({ kind, hex }) => {
    const v = validateWechatKey(kind, hex)
    if (!v.ok) return v
    storeKey(kind, v.hex)
    if (kind === 'db_key') config.set({ account: { verifiedAt: 0 } })
    return { ok: true }
  })

  handle('substrate:testConnection', async (target) => {
    const a = { ...config.get().account, ...target }
    if (!a.dbRoot || !a.wxid) return { ok: false, error: '请先选择数据库目录和账号' }
    const dbKeyHex = a.dbKeyRef ? secrets.reveal(a.dbKeyRef) ?? undefined : undefined
    if (!dbKeyHex) return { ok: false, error: '尚未获取数据库密钥' }
    return verifyAccount({ dbRoot: a.dbRoot, wxid: a.wxid, dbKeyHex })
  })

  const activate = createAccountActivator(ctx)
  handle('substrate:connect', (target) => activate(target))
  handle('substrate:sync', (o) => substrate.sync(o))

  handle('substrate:listSessions', async (q) => {
    const r = await substrate.listSessions(q)
    return { ...r, items: sortSessions(r.items) }
  })
  handle('substrate:getSession', ({ id }) => substrate.getSession(id))
  handle('substrate:listMessages', (q) => substrate.listMessages(q))
  handle('substrate:getContext', ({ anchor, radius }) => substrate.getContext(anchor, radius))
  handle('substrate:search', (q) => substrate.search(q))
  handle('substrate:listContacts', (q) => substrate.listContacts(q))
  handle('substrate:listGroupMembers', ({ groupId, ...page }) => substrate.listGroupMembers(groupId, page))
  handle('substrate:stats', (q) => substrate.stats(q))
  handle('substrate:resolveMedia', ({ sessionId, messageId }) => substrate.resolveMedia(sessionId, messageId))
  handle('substrate:transcribeVoice', ({ sessionId, messageId, force }) => substrate.transcribeVoice!(sessionId, messageId, { force }))

  // Flags / index maintenance live in the mirror (SubstrateExtras served by the utility process).
  handle('substrate:setSessionFlags', async ({ sessionId, ...flags }) => {
    await substrate.setSessionFlags(sessionId, flags)
  })
  handle('substrate:removeIndex', ({ sessionId }) => substrate.removeIndex(sessionId))
  handle('substrate:rebuildIndex', ({ sessionId }) => substrate.rebuildIndex(sessionId))

  handle('substrate:export', async ({ sessionId, format, from, to, messageIds, outDir }) => {
    const session = (await substrate.getSession(sessionId)) ?? { id: sessionId, title: sessionId, kind: 'dm' as const }
    const wanted = messageIds ? new Set(messageIds) : undefined
    const messages: WxMessage[] = []
    let afterSeq = 0
    while (messages.length < EXPORT_MAX) {
      const page = await substrate.listMessages({ sessionId, afterSeq, limit: EXPORT_PAGE, from, to })
      for (const m of page.items) if (!wanted || wanted.has(m.id)) messages.push(m)
      const last = page.items[page.items.length - 1]
      if (!page.hasMore || !last) break
      afterSeq = last.seq
    }
    const dir = outDir && ctx.allowList.isAllowed(outDir) ? outDir : ctx.paths.exportsDir
    if (outDir && dir !== outDir) log.warn('export outDir not in allow-list; using exports dir', { outDir })
    const { content, ext } = buildSessionExport(format, session, messages)
    const path = writeExport(dir, session.title, ext, content)
    ctx.toast({ kind: 'success', text: `已导出 ${messages.length} 条消息`, action: { label: '打开位置', command: 'tab.openFile' } })
    return { path }
  })
}
