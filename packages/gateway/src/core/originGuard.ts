/**
 * Origin-only rule for bot channels (ARCHITECTURE §6): a thread that originated from a WeChat chat may
 * only ever send back to that chat. The guard rewrites — never trusts — the target on bot channels,
 * so a model hallucinating `to` cannot leak content to another person.
 */
import type { ChannelKind, GatewayOutbound, SendRequest, SessionSource } from '@aiwc/protocol'

export interface Origin {
  channel: ChannelKind
  chatId?: string
  peerId?: string
}

export const isWechatChannel = (channel: ChannelKind | string | undefined): boolean => typeof channel === 'string' && channel.startsWith('wechat-')

/**
 * Channels with nobody at the keyboard, bound to one WeChat chat (mirrors the kernel's BOT_CHANNELS):
 * the wechat-* transports plus 'observed' (messages watched in the local WeChat client).
 */
export const isBotChannel = (channel: ChannelKind | string | undefined): boolean => isWechatChannel(channel) || channel === 'observed'

/** 'observed' has no adapter of its own: replies go back through the UI-injection leg of the same local client. */
export const OBSERVED_SEND_CHANNEL: ChannelKind = 'wechat-ui'

/** The channel a bot thread's reply travels on for a given origin channel. */
export const sendChannelForOrigin = (channel: ChannelKind): ChannelKind => (channel === 'observed' ? OBSERVED_SEND_CHANNEL : channel)

export const inferChatType = (chatId: string): SessionSource['chatType'] => (chatId.endsWith('@chatroom') ? 'group' : 'dm')

/** Build a SessionSource for a chat id when only the origin (channel + chatId) is known. */
export function sourceFromOrigin(origin: Origin & { chatId: string }): SessionSource {
  const chatType = inferChatType(origin.chatId)
  return {
    channel: origin.channel,
    chatId: origin.chatId,
    peerId: origin.peerId ?? origin.chatId,
    chatType,
  }
}

export class OriginViolationError extends Error {
  constructor(message = '该会话只能回复到来源聊天') {
    super(message)
    this.name = 'OriginViolationError'
  }
}

/**
 * Wrap an outbound so every send from a bot thread lands in its origin chat.
 *  - origin on a bot channel (wechat-* / observed): the target is forced to the origin chat on the
 *    origin's send channel. If the request already targets that chat its richer SessionSource
 *    (displayName, threadId) is kept.
 *  - desktop / cron origins: requests pass through unchanged (the approval gate covers them).
 */
export function withOriginGuard(outbound: GatewayOutbound, origin: Origin | undefined): GatewayOutbound {
  if (!origin || !isBotChannel(origin.channel)) return outbound
  const chatId = origin.chatId
  const channel = sendChannelForOrigin(origin.channel)
  return {
    async send(req: SendRequest) {
      if (!chatId) return { ok: false, error: '来源会话缺少 chatId，已拒绝发送' }
      const sameTarget = req.to.channel === channel && req.to.chatId === chatId
      const to = sameTarget ? req.to : sourceFromOrigin({ channel, chatId, peerId: origin.peerId })
      return outbound.send({ ...req, to })
    },
  }
}
