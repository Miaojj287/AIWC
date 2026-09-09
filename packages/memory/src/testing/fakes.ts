/**
 * Test doubles used by this package's vitest suites (no network, no WeChat, no native code):
 *  - createFakeSubstrate(): in-memory SubstrateService over plain WxSession / WxMessage arrays
 *  - createScriptedModel(): ModelClient whose text is produced by a handler(system, user)
 */
import type {
  ModelClient,
  ModelError,
  RelationshipProfile,
  SamplingPart,
  SamplingRequest,
  SubstrateService,
  WxContact,
  WxMessage,
  WxSession,
} from '@aiwc/protocol'

export interface FakeSubstrateData {
  sessions: WxSession[]
  messages: WxMessage[]
  contacts?: WxContact[]
}

export function fakeMessage(over: Partial<WxMessage> & { sessionId: string; seq: number; createdAt: number }): WxMessage {
  const id = over.id ?? `${over.sessionId}:${over.seq}`
  return {
    id,
    senderId: over.isSelf ? 'me' : over.sessionId,
    isSelf: false,
    kind: 'text',
    text: '',
    anchor: { sessionId: over.sessionId, messageId: id, seq: over.seq, createdAt: over.createdAt },
    ...over,
  }
}

export function fakeSession(over: Partial<WxSession> & { id: string }): WxSession {
  return { kind: 'dm', title: over.id, unread: 0, pinned: false, muted: false, ...over }
}

const notImplemented = (name: string) => async (): Promise<never> => {
  throw new Error(`fake substrate: ${name} not implemented`)
}

export function createFakeSubstrate(data: FakeSubstrateData): SubstrateService & { calls: string[] } {
  const calls: string[] = []
  const bySession = new Map<string, WxMessage[]>()
  for (const m of data.messages) {
    const arr = bySession.get(m.sessionId) ?? []
    arr.push(m)
    bySession.set(m.sessionId, arr)
  }
  for (const arr of bySession.values()) arr.sort((a, b) => a.seq - b.seq)

  return {
    calls,
    status: () => ({ connection: 'ready', sync: { phase: 'idle' } }),
    listAccounts: async () => [],
    getAccount: async () => undefined,
    async listSessions(q) {
      calls.push('listSessions')
      let items = data.sessions.slice()
      if (q.kind && q.kind !== 'all') items = items.filter((s) => s.kind === q.kind)
      if (q.query) items = items.filter((s) => s.title.includes(q.query as string))
      const offset = q.offset ?? 0
      const page = items.slice(offset, offset + q.limit)
      return { items: page, total: items.length, hasMore: offset + q.limit < items.length }
    },
    async getSession(id) {
      return data.sessions.find((s) => s.id === id)
    },
    async listMessages(q) {
      calls.push(`listMessages:${q.sessionId}`)
      let items = bySession.get(q.sessionId) ?? []
      if (q.from !== undefined) items = items.filter((m) => m.createdAt >= (q.from as number))
      if (q.to !== undefined) items = items.filter((m) => m.createdAt <= (q.to as number))
      if (q.kinds) items = items.filter((m) => q.kinds?.includes(m.kind))
      if (q.senderIds) items = items.filter((m) => q.senderIds?.includes(m.senderId))
      if (q.beforeSeq !== undefined) {
        const before = items.filter((m) => m.seq < (q.beforeSeq as number))
        const page = before.slice(Math.max(0, before.length - q.limit))
        return { items: page, hasMore: before.length > q.limit }
      }
      if (q.afterSeq !== undefined) items = items.filter((m) => m.seq > (q.afterSeq as number))
      return { items: items.slice(0, q.limit), hasMore: items.length > q.limit }
    },
    async getMessage(sessionId, messageId) {
      return (bySession.get(sessionId) ?? []).find((m) => m.id === messageId)
    },
    getContext: notImplemented('getContext'),
    search: async () => [],
    async listContacts(q) {
      const items = (data.contacts ?? []).slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
      return { items, total: data.contacts?.length ?? 0 }
    },
    async getContact(username) {
      return (data.contacts ?? []).find((c) => c.username === username)
    },
    listGroupMembers: async () => ({ items: [], total: 0 }),
    stats: notImplemented('stats'),
    resolveMedia: async () => undefined,
    sync: async () => ({ phase: 'idle' }),
    subscribe: () => () => {},
  }
}

export type ScriptedHandler = (system: string, user: string, req: SamplingRequest) => string | Promise<string>

export interface ScriptedModel extends ModelClient {
  calls: Array<{ system: string; user: string }>
}

/** A ModelClient that streams whatever `handler` returns; a thrown Error becomes an `error` part. */
export function createScriptedModel(handler: ScriptedHandler, opts: { chunk?: number; modelId?: string } = {}): ScriptedModel {
  const calls: Array<{ system: string; user: string }> = []
  const chunk = opts.chunk ?? 7
  return {
    calls,
    ref: {
      providerId: 'fake',
      modelId: opts.modelId ?? 'scripted',
      label: 'scripted',
      contextWindow: 128_000,
      supportsTools: false,
      supportsVision: false,
      local: true,
    },
    async *sample(req): AsyncIterable<SamplingPart> {
      const first = req.history[0]
      const user =
        first && first.type === 'user_message'
          ? first.content
              .map((p) => (p.type === 'text' ? p.text : ''))
              .join('')
          : ''
      calls.push({ system: req.system, user })
      let text: string
      try {
        text = await handler(req.system, user, req)
      } catch (e) {
        const error: ModelError = { code: 'unknown', message: e instanceof Error ? e.message : String(e), retryable: false }
        yield { type: 'error', error }
        return
      }
      for (let i = 0; i < text.length; i += chunk) {
        if (req.signal.aborted) {
          yield { type: 'finish', reason: 'aborted', usage: { inputTokens: 0, outputTokens: 0 } }
          return
        }
        yield { type: 'text.delta', delta: text.slice(i, i + chunk) }
      }
      yield { type: 'finish', reason: 'stop', usage: { inputTokens: 0, outputTokens: text.length } }
    },
  }
}

/** A complete RelationshipProfile fixture. */
export const sampleProfile = (over: Partial<RelationshipProfile> = {}): RelationshipProfile => ({
  contactId: 'wxid_test01',
  displayName: '李娜',
  card: {
    tone: ['轻快', '爱开玩笑'],
    traits: ['热心'],
    catchphrases: ['哈哈哈', '绝了'],
    punctuation: '几乎不用句号，爱用~',
    addressing: { self: '我', other: '老张' },
    topics: ['吃饭', '追剧'],
    replyHabits: { 被抱怨时: '先调侃再安慰' },
  },
  deep: {
    facts: ['在杭州做设计'],
    relationship: '大学同学，无话不谈',
    reactionPatterns: ['被夸时会自谦'],
    boundaries: ['不聊前任'],
    sharedEvents: [{ when: '2024 夏', what: '一起去青岛' }],
  },
  samples: [
    { prompt: '晚上吃啥', reply: '随便／你定', at: 1700000000000 },
    { prompt: '看剧没', reply: '看了看了 绝了', at: 1700000100000 },
  ],
  version: 1,
  updatedAt: 1700000200000,
  role: 'contact',
  corrections: [],
  ...over,
})
