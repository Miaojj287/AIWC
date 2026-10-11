/**
 * Owner gate for 我的微信: the only messages that may drive the Agent are the owner's own, in the private chat
 * with their iLink bot. The owner is the WeChat account that scanned and confirmed the login QR code (iLink's
 * `ilink_user_id`, bound at login and stored with the login); nothing a message says can change it.
 */
import type { MessageEvent } from '@aiwc/protocol'

export type OwnerGateReason = 'no_owner' | 'wrong_channel' | 'internal' | 'group' | 'not_owner'

export type OwnerGateVerdict = { ok: true } | { ok: false; reason: OwnerGateReason }

export function checkOwnerMessage(event: MessageEvent, ownerId: string | undefined): OwnerGateVerdict {
  const owner = ownerId?.trim()
  if (!owner) return { ok: false, reason: 'no_owner' }
  if (event.source.channel !== 'wechat-ilink') return { ok: false, reason: 'wrong_channel' }
  // Synthetic events (replays, tests) bypass authorisation elsewhere; here they never count as the owner.
  if (event.internal) return { ok: false, reason: 'internal' }
  if (event.source.chatType !== 'dm') return { ok: false, reason: 'group' }
  if (event.source.peerId !== owner || event.source.chatId !== owner) return { ok: false, reason: 'not_owner' }
  return { ok: true }
}

/** A peer id safe for logs and the settings page: the first and last few characters only. */
export function maskId(id: string): string {
  const value = id.trim()
  if (value.length <= 8) return `${value.slice(0, 2)}…`
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
