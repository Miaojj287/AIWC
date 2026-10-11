/**
 * The only way 我的微信 sends anything: to the owner bound at login, through the origin guard of a 'wechat-remote'
 * origin (so the target is rebuilt from the owner id and travels on the owner's iLink bot), and every attempt —
 * sent or not — is handed to the audit sink. Nothing here can address anyone but the owner.
 */
import type { GatewayOutbound, MobileSendKind, MobileSendRecord, SendResult } from '@aiwc/protocol'
import { withOriginGuard } from '../core/originGuard'

/** Stable error codes (the host words them); channel errors pass through as the channel's own text. */
export const OWNER_CHANNEL_ERRORS = { noOwner: 'no_owner', empty: 'empty' } as const

export interface OwnerChannelDeps {
  outbound: GatewayOutbound
  /** The bound owner (iLink user id), undefined while not logged in. */
  ownerId(): string | undefined
  audit(record: MobileSendRecord): void
  now?: () => number
}

export interface OwnerSendMeta {
  kind: MobileSendKind
  taskId?: string
  threadId?: string
}

export interface OwnerChannel {
  send(text: string, meta: OwnerSendMeta): Promise<SendResult>
}

export function createOwnerChannel(deps: OwnerChannelDeps): OwnerChannel {
  const now = deps.now ?? (() => Date.now())
  return {
    async send(text, meta) {
      const owner = deps.ownerId()?.trim()
      const body = text.trim()
      let result: SendResult
      if (!owner) result = { ok: false, error: OWNER_CHANNEL_ERRORS.noOwner }
      else if (!body) result = { ok: false, error: OWNER_CHANNEL_ERRORS.empty }
      else {
        const guarded = withOriginGuard(deps.outbound, { channel: 'wechat-remote', chatId: owner, peerId: owner })
        try {
          result = await guarded.send({
            // The guard rewrites the target from the origin; this is only what we mean to reach.
            to: { channel: 'wechat-ilink', chatId: owner, peerId: owner, chatType: 'dm' },
            parts: [{ type: 'text', text: body }],
            reason: meta.kind === 'task' ? 'cron' : 'user_action',
          })
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
      deps.audit({
        at: now(),
        kind: meta.kind,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error ?? 'unknown' }),
        chars: Array.from(body).length,
        ...(meta.taskId ? { taskId: meta.taskId } : {}),
        ...(meta.threadId ? { threadId: meta.threadId } : {}),
      })
      return result
    },
  }
}
