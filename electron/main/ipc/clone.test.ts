import { describe, expect, it, vi } from 'vitest'
import type { CloneStatus, InvokeChannel, InvokeReq, InvokeRes, RelationshipProfile } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { HostBridge } from './register'
import { registerCloneIpc } from './clone'
import { createHandlerHarness } from './testing/handlerHarness'

interface Session {
  id: string
  title: string
  kind: 'dm' | 'group'
  indexedCount?: number
  lastMessageAt?: number
  avatarPath?: string
}

function setup(
  opts: {
    sessions?: Session[]
    cloned?: Array<{ contactId: string; displayName: string; status: CloneStatus }>
    sessionsThrow?: boolean
    profiles?: RelationshipProfile[]
  } = {},
) {
  const sessions = opts.sessions ?? []
  const substrate = {
    listSessions: vi.fn(async ({ kind }: { kind?: string }) => {
      if (opts.sessionsThrow) throw new Error('尚未连接微信数据')
      const items = sessions.filter((s) => !kind || kind === 'all' || s.kind === kind)
      return { items, total: items.length, hasMore: false }
    }),
    getSession: vi.fn(async (id: string) => sessions.find((s) => s.id === id)),
    listMessages: vi.fn(async () => ({ items: [], hasMore: false })),
  }
  const stored = new Map((opts.profiles ?? []).map((p) => [p.contactId, p]))
  const relationships = {
    list: vi.fn(async () => opts.cloned ?? []),
    get: vi.fn(async (id: string) => stored.get(id)),
    status: vi.fn(async (): Promise<CloneStatus> => ({ state: 'none', messageCount: 0 })),
    upsert: vi.fn(async (p: RelationshipProfile) => {
      stored.set(p.contactId, p)
    }),
    remove: vi.fn(async () => undefined),
    addNotes: vi.fn(async () => undefined),
    listNotes: vi.fn(async () => []),
    removeNote: vi.fn(async () => undefined),
    getReflected: vi.fn(async () => 0),
    setReflected: vi.fn(async () => undefined),
  }
  const clone = { start: vi.fn(async () => undefined), cancel: vi.fn() }
  const kernel = { ensureThread: vi.fn(), submit: vi.fn(), getThread: vi.fn() }
  const toast = vi.fn()
  const ipc = createHandlerHarness()
  const logger = { child: () => logger, warn: vi.fn() }
  registerCloneIpc(
    { logger, relationships, substrate, clone, kernel, toast, records: {}, models: {} } as unknown as AppContext,
    {} as HostBridge,
    ipc.handle,
  )
  const invoke = async <K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> =>
    ipc.invoke(channel, req)
  /** Renderer input as it may arrive: untyped, and possibly thrown synchronously by the handler. */
  const invokeRaw = (channel: InvokeChannel, req: unknown): Promise<unknown> =>
    Promise.resolve().then(() => ipc.invokeRaw(channel, req))
  return { invoke, invokeRaw, substrate, relationships, clone, kernel, toast }
}

const profileFixture = (): RelationshipProfile => ({
  contactId: 'wxid_a',
  displayName: '阿星',
  card: {
    tone: ['轻快'],
    traits: ['热心'],
    catchphrases: ['哈哈'],
    punctuation: '',
    addressing: {},
    topics: [],
    replyHabits: {},
  },
  deep: { facts: ['在杭州工作'], relationship: '大学同学', reactionPatterns: [], boundaries: [], sharedEvents: [] },
  samples: [{ prompt: '在吗', reply: '在的', at: 1 }],
  version: 1,
  updatedAt: 1,
  role: 'contact',
  corrections: [],
})

const READY: CloneStatus = { state: 'ready', version: 2, sampleCount: 8, builtAt: 1_700_000_000_000 }

describe('clone:list', () => {
  it('offers every DM contact, not just the ones already cloned', async () => {
    const { invoke } = setup({
      sessions: [
        { id: 'wxid_a', title: '阿星', kind: 'dm', indexedCount: 1284, lastMessageAt: 5 },
        { id: 'wxid_b', title: '小雨', kind: 'dm', indexedCount: 12, lastMessageAt: 4 },
      ],
    })
    const list = await invoke('clone:list', undefined)
    expect(list.map((e) => e.contactId)).toEqual(['wxid_a', 'wxid_b'])
    expect(list[0]).toMatchObject({
      displayName: '阿星',
      status: { state: 'none', messageCount: 1284 },
      lastContactAt: 5,
    })
  })

  it('excludes group chats — only DMs can be cloned', async () => {
    const { invoke, substrate } = setup({ sessions: [{ id: 'g1', title: '业主群', kind: 'group' }] })
    expect(await invoke('clone:list', undefined)).toEqual([])
    expect(substrate.listSessions).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dm' }))
  })

  it('keeps the clone status (and avatar) of contacts that already have a profile', async () => {
    const { invoke } = setup({
      sessions: [{ id: 'wxid_a', title: '阿星（新备注）', kind: 'dm', indexedCount: 1284, avatarPath: '/tmp/a.jpg' }],
      cloned: [{ contactId: 'wxid_a', displayName: '阿星', status: READY }],
    })
    const list = await invoke('clone:list', undefined)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ contactId: 'wxid_a', displayName: '阿星', status: READY, avatarPath: '/tmp/a.jpg' })
  })

  it('still lists a clone whose session the substrate no longer knows', async () => {
    const { invoke } = setup({ sessions: [], cloned: [{ contactId: 'gone', displayName: '旧联系人', status: READY }] })
    expect(await invoke('clone:list', undefined)).toMatchObject([{ contactId: 'gone', status: READY }])
  })

  it('falls back to the cloned-only view when the substrate is not connected', async () => {
    const { invoke } = setup({
      sessionsThrow: true,
      cloned: [{ contactId: 'wxid_a', displayName: '阿星', status: READY }],
    })
    const list = await invoke('clone:list', undefined)
    expect(list.map((e) => e.contactId)).toEqual(['wxid_a'])
  })
})

describe('clone:updateProfile', () => {
  it('records a large edit as one untruncated correction holding only the edited keys', async () => {
    const profile = profileFixture()
    const { invoke, relationships } = setup({ profiles: [profile] })
    const facts = Array.from({ length: 40 }, (_, i) => `事实 ${i}：${'一段很长的细节描述'.repeat(10)}`)
    const next = await invoke('clone:updateProfile', {
      contactId: 'wxid_a',
      patch: { card: profile.card, deep: { ...profile.deep, facts }, samples: profile.samples },
    })
    expect(next.deep.facts).toEqual(facts)
    expect(next.deep.relationship).toBe('大学同学')
    const saved = relationships.upsert.mock.calls.at(-1)?.[0]
    expect(saved?.corrections).toHaveLength(1) // card and samples were resent unchanged
    const [row] = saved?.corrections ?? []
    expect(row?.field).toBe('deep')
    expect(JSON.parse(row?.to ?? '')).toEqual({ facts })
    expect(JSON.parse(row?.from ?? '')).toEqual({ facts: ['在杭州工作'] })
  })

  it('refuses requests that are not profile edits before reading or writing the profile', async () => {
    const { invokeRaw, relationships } = setup({ profiles: [profileFixture()] })
    const malformed: unknown[] = [
      undefined,
      'card',
      { stats: { messageCount: 1 } },
      { card: { tone: '温和' } },
      { card: { addressing: '阿星' } },
      { deep: { facts: [1] } },
      { samples: [{ prompt: '在吗' }] },
      { samples: [{ prompt: '在吗', reply: '好'.repeat(20_001) }] },
    ]
    for (const patch of malformed) {
      await expect(
        invokeRaw('clone:updateProfile', { contactId: 'wxid_a', patch }),
        JSON.stringify(patch) ?? 'undefined',
      ).rejects.toThrow(t('main.clone.invalidProfilePatch'))
    }
    expect(relationships.get).not.toHaveBeenCalled()
    expect(relationships.upsert).not.toHaveBeenCalled()
  })

  it('drops unknown nested keys and keys sent as undefined instead of storing or erasing anything', async () => {
    const profile = profileFixture()
    const { invokeRaw } = setup({ profiles: [profile] })
    const next = (await invokeRaw('clone:updateProfile', {
      contactId: 'wxid_a',
      patch: {
        card: { tone: ['温和'], punctuation: undefined, mood: ['开心'] },
        samples: [{ prompt: '在吗', reply: '在的', at: 1, score: 0.9 }],
      },
    })) as RelationshipProfile
    expect(next.card).toEqual({ ...profile.card, tone: ['温和'] })
    expect(next.samples).toEqual([{ prompt: '在吗', reply: '在的', at: 1 }])
  })
})

describe('contact id validation', () => {
  const CHANNELS: Array<[InvokeChannel, Record<string, unknown>]> = [
    ['clone:get', {}],
    ['clone:status', {}],
    ['clone:sampleMessages', { limit: 10 }],
    ['clone:start', {}],
    ['clone:cancel', {}],
    ['clone:delete', {}],
    ['clone:updateProfile', { patch: {} }],
    ['clone:chat', { threadId: 'thr_1', text: 'hi' }],
    ['clone:feedback', { messageItemId: 'itm_1', verdict: 'up' }],
    ['clone:notes', {}],
    ['clone:deleteNote', { at: 1 }],
    ['clone:reflect', { threadId: 'thr_1' }],
  ]

  it('refuses ids that could never name a contact folder before any store, builder or kernel call', async () => {
    const { invokeRaw, relationships, clone, kernel, substrate, toast } = setup({ profiles: [profileFixture()] })
    for (const [channel, rest] of CHANNELS) {
      for (const contactId of ['', '   ', '.', '..', '../wxid_a', 'a/b', 'a\\b', 42, undefined]) {
        await expect(invokeRaw(channel, { ...rest, contactId }), `${channel} ${String(contactId)}`).rejects.toThrow(
          t('main.clone.invalidContactId'),
        )
      }
    }
    for (const fn of [
      ...Object.values(relationships),
      clone.start,
      clone.cancel,
      kernel.ensureThread,
      substrate.listMessages,
      substrate.getSession,
      toast,
    ])
      expect(fn).not.toHaveBeenCalled()
  })

  it('accepts real WeChat id shapes', async () => {
    const { invoke, relationships } = setup()
    for (const contactId of ['wxid_abc123', 'someone_42', '12345678@chatroom', 'abc@openim', 'gh_0a1b2c'])
      await invoke('clone:get', { contactId })
    expect(relationships.get.mock.calls.map(([id]) => id)).toEqual([
      'wxid_abc123',
      'someone_42',
      '12345678@chatroom',
      'abc@openim',
      'gh_0a1b2c',
    ])
  })
})
