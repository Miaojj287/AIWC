/**
 * In-memory PlatformAdapter for unit tests (no network / no UI). Exposed from the barrel so other
 * packages' tests and the web-only mock bridge can reuse it.
 */
import type { AdapterState, ChannelKind, MessageEvent, PlatformAdapter, SendRequest, SendResult, SessionSource } from '@aiwc/protocol'
import { createEmitter } from '../core/emitter'
import type { AdapterExtras } from '../core/gateway'

export interface FakeAdapter extends PlatformAdapter, AdapterExtras {
  emitMessage(event: MessageEvent): void
  setState(state: AdapterState, detail?: string): void
  readonly sent: SendRequest[]
  /** Override to simulate failures. */
  sendImpl: (req: SendRequest) => Promise<SendResult>
  emitQr(dataUrl: string): void
}

export function createFakeAdapter(channel: ChannelKind, opts: { mentionPatterns?: readonly string[]; supportsQr?: boolean } = {}): FakeAdapter {
  const messages = createEmitter<MessageEvent>()
  const states = createEmitter<{ state: AdapterState; detail?: string }>()
  const qr = createEmitter<string>()
  const sent: SendRequest[] = []
  let state: AdapterState = 'disconnected'
  let counter = 0

  const adapter: FakeAdapter = {
    channel,
    capabilities: { typing: false, media: ['text', 'image', 'file'], splitsLongMessages: false, maxTextLength: 4000 },
    get state() {
      return state
    },
    mentionPatterns: opts.mentionPatterns,
    async connect() {
      adapter.setState('connected')
    },
    async disconnect() {
      adapter.setState('disconnected')
    },
    onMessage: (handler) => messages.on((e) => void handler(e)),
    onStateChange: (handler) => states.on(({ state: s, detail }) => handler(s, detail)),
    sendImpl: async (req) => {
      sent.push(req)
      return { ok: true, messageId: `${channel}_${++counter}` }
    },
    send: (req) => adapter.sendImpl(req),
    emitMessage: (event) => messages.emit(event),
    setState(next, detail) {
      state = next
      states.emit({ state: next, detail })
    },
    sent,
    emitQr: (dataUrl) => qr.emit(dataUrl),
  }
  if (opts.supportsQr) adapter.onQr = (handler) => qr.on(handler)
  return adapter
}

export function fakeEvent(over: Partial<MessageEvent> & { source?: Partial<SessionSource> } = {}): MessageEvent {
  const source: SessionSource = {
    channel: 'wechat-ilink',
    peerId: 'u_alice',
    chatId: 'u_alice',
    chatType: 'dm',
    displayName: 'Alice',
    ...over.source,
  }
  return {
    id: over.id ?? `m_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    text: 'hello',
    timestamp: 1_700_000_000_000,
    addressed: source.chatType === 'dm',
    ...over,
    source,
  }
}
