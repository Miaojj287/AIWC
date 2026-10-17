import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AccountTargetSchema,
  WechatAcquireRequestSchema,
  WechatAcquireResultSchema,
  WechatDatabaseCoverageSchema,
  type AccountTarget,
  type WechatCredentialStatus,
} from '@aiwc/protocol'
import { runKeyHost } from '../substrate/keyAcquireClient'
import { readWechatCredentials, saveWechatDatabase } from '../services/wechatCredentials'
import { SECRET_REFS } from '../config/secretStore'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import type { AccountCredentials } from '../services/accountSession'
import { t } from '../i18n'

/** Account-scoped connection capabilities, including only page-authenticated cached databases. */
export function createWechatConnection(ctx: AppContext, host: HostBridge) {
  const entry = join(dirname(fileURLToPath(import.meta.url)), 'keyAcquireHost.js')
  const credentials = (target: AccountTarget): AccountCredentials => host.accountSession?.credentials(target) ?? ctx
  const inspect = async (target: AccountTarget): Promise<WechatCredentialStatus> => {
    const saved = credentials(target)
    const material = readWechatCredentials(saved, target.wxid)
    const result = await runKeyHost({
      entry,
      nativeDir: ctx.paths.nativeDir,
      request: { wxid: target.wxid, dbRoot: target.dbRoot, strategy: 'auto', scope: 'database' },
      operation: 'inspect',
      ...material,
    })
    const coverage = WechatDatabaseCoverageSchema.parse(result)
    const account = saved.config.get().account
    return {
      ...coverage,
      revision: account.credentialRevision ?? 0,
      imageXor: Boolean(account.imageXorKeyRef && saved.secrets.reveal(account.imageXorKeyRef)),
      imageAes: Boolean(account.imageAesKeyRef && saved.secrets.reveal(account.imageAesKeyRef)),
    }
  }
  const verify = async (target: AccountTarget) => {
    const status = await inspect(target)
    return status.database ? { ok: true } : { ok: false, error: t('main.substrate.accountKeyMissing') }
  }
  const controllers = new Set<AbortController>()
  let pending: Promise<unknown> = Promise.resolve()
  const cancel = () => {
    for (const controller of controllers) controller.abort()
  }
  const settle = async () => {
    cancel()
    await pending
  }
  const acquireRun = async (
    request: ReturnType<typeof WechatAcquireRequestSchema.parse>,
    controller: AbortController,
  ) => {
    if (controller.signal.aborted) return []
    const target = { wxid: request.wxid, dbRoot: request.dbRoot }
    const saved = credentials(target)
    const run = async () => {
      const result = WechatAcquireResultSchema.parse(
        await runKeyHost({
          entry,
          nativeDir: ctx.paths.nativeDir,
          request,
          operation: 'acquire',
          signal: controller.signal,
          onStep: (step) => {
            if (!controller.signal.aborted) ctx.broadcast('substrate:keyStep', step)
          },
          onDatabase: (database) => {
            if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError')
            saveWechatDatabase(saved, target, database)
          },
        }),
      )
      if (result.cancelled || controller.signal.aborted) return result.steps
      const account = saved.config.get().account
      if (result.imageXorHex) saved.secrets.set(SECRET_REFS.imageXorKey, result.imageXorHex)
      if (result.imageAesHex) saved.secrets.set(SECRET_REFS.imageAesKey, result.imageAesHex)
      if (result.imageXorHex || result.imageAesHex) {
        saved.config.set({
          account: {
            ...(result.imageXorHex ? { imageXorKeyRef: SECRET_REFS.imageXorKey } : {}),
            ...(result.imageAesHex ? { imageAesKeyRef: SECRET_REFS.imageAesKey } : {}),
            credentialRevision: (account.credentialRevision ?? 0) + 1,
          },
        })
      }
      if (
        (result.dbKeyHex || result.imageXorHex || result.imageAesHex) &&
        saved.config === ctx.config &&
        ctx.substrate.status().connection === 'ready'
      ) {
        const reconnected = await ctx.substrate.reconnect()
        if (!reconnected.ok) throw new Error(reconnected.error ?? t('main.substrate.connectFailed'))
      }
      const success =
        request.scope === 'image' ? Boolean(result.imageXorHex || result.imageAesHex) : Boolean(result.dbKeyHex)
      ctx.toast({
        id: 'substrate.acquireKeys',
        kind: success ? 'success' : 'warning',
        text: success ? t('main.substrate.keysAcquired') : t('main.substrate.keysAcquireFailed'),
      })
      return result.steps
    }
    try {
      return await run()
    } catch (error) {
      if (controller.signal.aborted) return []
      throw error
    }
  }
  const acquire = (raw: unknown) => {
    const request = WechatAcquireRequestSchema.parse(raw)
    cancel()
    const controller = new AbortController()
    controllers.add(controller)
    const result = pending.then(() => acquireRun(request, controller)).finally(() => controllers.delete(controller))
    pending = result.catch(() => {
      /* Each caller receives its own acquisition failure. */
    })
    return result
  }
  return { inspect, verify, acquire, cancel, settle }
}

/** Thin validated handlers for explicit native acquisition and cached capability lookup. */
export function registerWechatConnection(handle: Handle, connection: ReturnType<typeof createWechatConnection>): void {
  handle('substrate:credentialStatus', (raw) => connection.inspect(AccountTargetSchema.parse(raw)))
  handle('substrate:verifyAccount', (raw) => connection.verify(AccountTargetSchema.parse(raw)))
  handle('substrate:testConnection', (raw) => connection.verify(AccountTargetSchema.parse(raw)))
  handle('substrate:acquireKeys', (raw) => connection.acquire(raw))
  handle('substrate:cancelAcquireKeys', connection.cancel)
}
