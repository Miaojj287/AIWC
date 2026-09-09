/**
 * Channel layer contract. Every inbound source (desktop composer, WeChat iLink bot, WeChat UI
 * observation, cron) is normalised to MessageEvent; every outbound goes through PlatformAdapter.send.
 */
import type { Millis } from './ids'

export type ChannelKind = 'desktop' | 'wechat-ilink' | 'wechat-ui' | 'cron' | 'observed'
export type ChatType = 'dm' | 'group'

export interface SessionSource {
  channel: ChannelKind
  /** Stable id of the counterpart (wxid / ilink user id / 'me' for desktop). */
  peerId: string
  /** Chat container id (for dm equals peerId). */
  chatId: string
  chatType: ChatType
  /** Optional sub-thread (e.g. quoted-reply thread). */
  threadId?: string
  displayName?: string
}

export type InboundKind = 'text' | 'image' | 'voice' | 'file' | 'video' | 'sticker' | 'system' | 'command'

export interface MessageEvent {
  id: string
  source: SessionSource
  kind: InboundKind
  text: string
  /** Local file paths already downloaded/decrypted so vision / STT can read them. */
  mediaPaths?: string[]
  replyTo?: { messageId: string; text?: string; authorName?: string; isOwn?: boolean }
  timestamp: Millis
  /** Set for synthetic events (cron, observed replay) that bypass authorization. */
  internal?: boolean
  /** True when this message was addressed to the agent (mention / dm / command). */
  addressed: boolean
  raw?: unknown
}

export type OutboundPart =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string }
  | { type: 'file'; path: string; name?: string }
  | { type: 'voice'; path: string; durationMs?: number }
  | { type: 'sticker'; id: string }

export interface SendRequest {
  to: SessionSource
  parts: OutboundPart[]
  /** Opaque token some channels require to be echoed (iLink context_token). */
  contextToken?: string
  expectedAccountId?: string
  ruleId?: string
  /** Where this send was decided: needed for audit and for the origin-only rule. */
  reason: 'agent_tool' | 'auto_reply' | 'user_action' | 'cron'
}

export interface SendResult {
  ok: boolean
  messageId?: string
  /** For the UI-injection channel: true only when the message was read back from the local DB. */
  verified?: boolean
  error?: string
}

export interface AdapterCapabilities {
  typing: boolean
  media: readonly OutboundPart['type'][]
  /** Adapter can split long text natively. */
  splitsLongMessages: boolean
  maxTextLength: number
}

export type AdapterState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'needs_login'

export interface PlatformAdapter {
  readonly channel: ChannelKind
  readonly capabilities: AdapterCapabilities
  readonly state: AdapterState
  connect(): Promise<void>
  disconnect(): Promise<void>
  onMessage(handler: (event: MessageEvent) => void | Promise<void>): () => void
  onStateChange(handler: (state: AdapterState, detail?: string) => void): () => void
  send(req: SendRequest): Promise<SendResult>
  sendTyping?(to: SessionSource): Promise<void>
  /** Recall a sent message when the channel supports it (WeChat: within 2 minutes). */
  recall?(messageId: string, to: SessionSource): Promise<SendResult>
}

export type ReplyDecision =
  | { reply: true; reason: string }
  | { reply: false; reason: string; observe: boolean }

/** Injected into tools that may send. Enforces origin-only for bot channels. */
export interface GatewayOutbound {
  send(req: SendRequest): Promise<SendResult>
}

export type GatewayEvent =
  | { type: 'adapter.state'; channel: ChannelKind; state: AdapterState; detail?: string }
  | { type: 'inbound'; event: MessageEvent }
  | { type: 'outbound'; req: SendRequest; result: SendResult }
  | { type: 'autoreply.generating'; sessionId: string; name: string; active: boolean }
  | { type: 'autoreply.queued'; draftId: string }
  | { type: 'autoreply.countdown'; draftId: string; remainingMs: number }
  | { type: 'autoreply.halted'; reason: string }
  | { type: 'login.qr'; channel: ChannelKind; qrDataUrl: string }
