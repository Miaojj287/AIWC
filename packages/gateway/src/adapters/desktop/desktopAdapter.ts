/**
 * Desktop adapter: the renderer composer treated as a channel. Inbound events are injected by the
 * host; send() succeeds immediately because the renderer renders replies from kernel events.
 */
import type { AdapterState, MessageEvent, PlatformAdapter, SendRequest, SendResult, SessionSource } from '@aiwc/protocol'
import { createEmitter } from '../../core/emitter'

export interface DesktopAdapter extends PlatformAdapter {
  readonly channel: 'desktop'
  inject(event: MessageEvent): void
  /** Convenience: build + inject a text event from the composer. */
  injectText(text: string, opts?: { chatId?: string; threadId?: string; id?: string; timestamp?: number }): MessageEvent
  /** Everything send() was asked to deliver, for the host/tests to inspect. */
  readonly sent: readonly SendRequest[]
}

export const DESKTOP_SELF_PEER = 'me'

export function desktopSource(opts: { chatId?: string; threadId?: string } = {}): SessionSource {
  const chatId = opts.chatId ?? DESKTOP_SELF_PEER
  return { channel: 'desktop', peerId: DESKTOP_SELF_PEER, chatId, chatType: 'dm', threadId: opts.threadId, displayName: '我' }
}

export function createDesktopAdapter(opts: { now?: () => number } = {}): DesktopAdapter {
  const now = opts.now ?? (() => Date.now())
  const messages = createEmitter<MessageEvent>()
  const states = createEmitter<{ state: AdapterState; detail?: string }>()
  const sent: SendRequest[] = []
  let state: AdapterState = 'disconnected'
  let counter = 0

  const setState = (next: AdapterState, detail?: string): void => {
    if (state === next) return
    state = next
    states.emit({ state: next, detail })
  }

  return {
    channel: 'desktop',
    capabilities: { typing: false, media: ['text', 'image', 'file'], splitsLongMessages: true, maxTextLength: 100_000 },
    get state() {
      return state
    },
    async connect() {
      setState('connected')
    },
    async disconnect() {
      setState('disconnected')
    },
    onMessage: (handler) => messages.on((e) => void handler(e)),
    onStateChange: (handler) => states.on(({ state: s, detail }) => handler(s, detail)),
    async send(req: SendRequest): Promise<SendResult> {
      sent.push(req)
      return { ok: true, messageId: `desktop_${now()}_${++counter}` }
    },
    inject(event) {
      messages.emit(event)
    },
    injectText(text, o = {}) {
      const event: MessageEvent = {
        id: o.id ?? `desk_${now()}_${++counter}`,
        source: desktopSource(o),
        kind: 'text',
        text,
        timestamp: o.timestamp ?? now(),
        addressed: true,
      }
      messages.emit(event)
      return event
    },
    sent,
  }
}
