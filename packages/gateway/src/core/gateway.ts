/**
 * Gateway core: adapter registry + authz + reply gate + observation + outbound routing.
 *
 * One inbound pipeline for every channel:
 *   adapter.onMessage → authz (allow-list) → ReplyGate.decide → observe (group, unaddressed)
 *   → onInbound(event, decision, sessionKey)
 *
 * The gateway never calls a model and never decides *what* to reply; it only decides whether the
 * host should (decision) and where the answer must go (outbound + origin guard).
 */
import type {
  AdapterState,
  AutoReplyRule,
  ChannelKind,
  ContextFragment,
  GatewayEvent,
  GatewayOutbound,
  MessageEvent,
  PlatformAdapter,
  ReplyDecision,
  SendRequest,
  SendResult,
  SessionKey,
  SessionSource,
} from '@aiwc/protocol'
import { buildSessionKey } from '../session/sessionKey'
import { createReplyGate, type ReplyGate } from '../gate/replyGate'
import { createObservedBuffer, type ObservedBuffer } from '../observed/observedBuffer'
import { createEmitter, errorMessage } from './emitter'

export type InboundHandler = (event: MessageEvent, decision: ReplyDecision, sessionKey: SessionKey) => void | Promise<void>

export interface Gateway {
  registerAdapter(adapter: PlatformAdapter): void
  unregisterAdapter(channel: ChannelKind): void
  getAdapter(channel: ChannelKind): PlatformAdapter | undefined
  connect(channel: ChannelKind): Promise<void>
  disconnect(channel: ChannelKind): Promise<void>
  status(): Array<{ channel: ChannelKind; state: AdapterState; detail?: string }>
  /** Normalised inbound stream after authz + reply gate; `decision` tells the host what to do. */
  onInbound(handler: InboundHandler): () => void
  /** Routes by req.to.channel; wrap with withOriginGuard() before handing to a bot thread. */
  outbound: GatewayOutbound
  events: { on(listener: (e: GatewayEvent) => void): () => void }
  /** Host-side emit for components that extend the gateway (auto-reply service, UI-inject sender). */
  emit(e: GatewayEvent): void
  observed: {
    take(chatId: string, max?: number): MessageEvent[]
    fragment(chatId: string): ContextFragment | undefined
    peek(chatId: string): MessageEvent[]
    size(chatId: string): number
  }
  gate: ReplyGate
  /** Feed a message as if an adapter delivered it (tests, replays). */
  ingest(event: MessageEvent): Promise<void>
  shutdown(): Promise<void>
}

/** Optional adapter extras the core understands when present. */
export interface AdapterExtras {
  /** Text patterns that mean "addressed to me" in group chats (e.g. '@AIWC'). */
  mentionPatterns?: readonly string[]
  /** QR login stream (iLink); surfaced as GatewayEvent 'login.qr'. */
  onQr?(handler: (dataUrl: string) => void): () => void
}

export interface GatewayDeps {
  rules: () => Promise<AutoReplyRule[]>
  /**
   * Peer allow-list. Default: desktop and wechat-ilink allowed (the owner paired the bot account
   * themself), everything else denied silently.
   */
  isAllowed?: (source: SessionSource, event: MessageEvent) => boolean | Promise<boolean>
  now?: () => number
  observed?: { max?: number; ttlMs?: number }
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export function defaultIsAllowed(source: SessionSource): boolean {
  return source.channel === 'desktop' || source.channel === 'wechat-ilink'
}

export function createGateway(deps: GatewayDeps): Gateway {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const events = createEmitter<GatewayEvent>((err) => log('warn', 'gateway listener threw', errorMessage(err)))
  const inbound = new Set<InboundHandler>()
  const adapters = new Map<ChannelKind, { adapter: PlatformAdapter & AdapterExtras; detail?: string; unsubscribe: () => void }>()
  const observed: ObservedBuffer = createObservedBuffer({ ...deps.observed, now })
  const gate = createReplyGate({})
  const isAllowed = deps.isAllowed ?? defaultIsAllowed

  async function findRule(chatId: string): Promise<AutoReplyRule | undefined> {
    try {
      const rules = await deps.rules()
      return rules.find((r) => r.sessionId === chatId)
    } catch (err) {
      log('warn', 'rules lookup failed', errorMessage(err))
      return undefined
    }
  }

  // Inbound is serialised: authz / rule lookups are async and a burst from one chat must reach the
  // host in arrival order.
  let chain: Promise<void> = Promise.resolve()
  function ingest(event: MessageEvent): Promise<void> {
    const next = chain.then(() => process(event)).catch((err) => log('error', 'ingest failed', errorMessage(err)))
    chain = next
    return next
  }

  async function process(event: MessageEvent): Promise<void> {
    if (!event.internal) {
      let allowed = false
      try {
        allowed = await isAllowed(event.source, event)
      } catch (err) {
        log('warn', 'authz threw; denying', errorMessage(err))
      }
      if (!allowed) {
        log('debug', 'inbound denied by allow-list', { channel: event.source.channel, peerId: event.source.peerId })
        return
      }
    }
    events.emit({ type: 'inbound', event })

    const rule = await findRule(event.source.chatId)
    const decision = gate.decide(event, rule)
    if (!decision.reply && decision.observe && event.source.chatType === 'group') observed.push(event)

    const sessionKey = buildSessionKey(event.source)
    for (const handler of [...inbound]) {
      try {
        await handler(event, decision, sessionKey)
      } catch (err) {
        log('error', 'inbound handler failed', errorMessage(err))
      }
    }
  }

  function attach(adapter: PlatformAdapter & AdapterExtras): () => void {
    const offs: Array<() => void> = []
    offs.push(adapter.onMessage((event) => ingest(event)))
    offs.push(
      adapter.onStateChange((state, detail) => {
        const entry = adapters.get(adapter.channel)
        if (entry) entry.detail = detail
        events.emit({ type: 'adapter.state', channel: adapter.channel, state, detail })
      }),
    )
    if (adapter.onQr) offs.push(adapter.onQr((qrDataUrl) => events.emit({ type: 'login.qr', channel: adapter.channel, qrDataUrl })))
    return () => offs.forEach((off) => off())
  }

  const outbound: GatewayOutbound = {
    async send(req: SendRequest): Promise<SendResult> {
      const entry = adapters.get(req.to.channel)
      let result: SendResult
      if (!entry) result = { ok: false, error: `通道未注册：${req.to.channel}` }
      else if (req.parts.length === 0) result = { ok: false, error: '没有可发送的内容' }
      else {
        try {
          result = await entry.adapter.send(req)
        } catch (err) {
          result = { ok: false, error: errorMessage(err) }
        }
      }
      events.emit({ type: 'outbound', req, result })
      return result
    },
  }

  const requireAdapter = (channel: ChannelKind): PlatformAdapter => {
    const entry = adapters.get(channel)
    if (!entry) throw new Error(`通道未注册：${channel}`)
    return entry.adapter
  }

  return {
    registerAdapter(adapter) {
      const existing = adapters.get(adapter.channel)
      if (existing) existing.unsubscribe()
      adapters.set(adapter.channel, { adapter, unsubscribe: attach(adapter) })
    },
    unregisterAdapter(channel) {
      const entry = adapters.get(channel)
      if (!entry) return
      entry.unsubscribe()
      adapters.delete(channel)
    },
    getAdapter: (channel) => adapters.get(channel)?.adapter,
    async connect(channel) {
      await requireAdapter(channel).connect()
    },
    async disconnect(channel) {
      await requireAdapter(channel).disconnect()
    },
    status() {
      return [...adapters.values()].map(({ adapter, detail }) => ({ channel: adapter.channel, state: adapter.state, detail }))
    },
    onInbound(handler) {
      inbound.add(handler)
      return () => {
        inbound.delete(handler)
      }
    },
    outbound,
    events: { on: events.on },
    emit: events.emit,
    observed: {
      take: observed.take,
      fragment: observed.fragment,
      peek: observed.peek,
      size: observed.size,
    },
    gate,
    ingest,
    async shutdown() {
      for (const [channel, entry] of adapters) {
        try {
          if (entry.adapter.state !== 'disconnected') await entry.adapter.disconnect()
        } catch (err) {
          log('warn', `disconnect ${channel} failed`, errorMessage(err))
        }
        entry.unsubscribe()
      }
      adapters.clear()
      inbound.clear()
    },
  }
}
