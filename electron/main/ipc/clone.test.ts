import { describe, expect, it, vi } from 'vitest'
import type { CloneStatus, InvokeChannel, InvokeReq, InvokeRes } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { Handle, Handler, HostBridge } from './register'
import { registerCloneIpc } from './clone'

interface Session {
  id: string
  title: string
  kind: 'dm' | 'group'
  indexedCount?: number
  lastMessageAt?: number
  avatarPath?: string
}

function setup(opts: { sessions?: Session[]; cloned?: Array<{ contactId: string; displayName: string; status: CloneStatus }>; sessionsThrow?: boolean } = {}) {
  const sessions = opts.sessions ?? []
  const substrate = {
    listSessions: vi.fn(async ({ kind }: { kind?: string }) => {
      if (opts.sessionsThrow) throw new Error('尚未连接微信数据')
      const items = sessions.filter((s) => !kind || kind === 'all' || s.kind === kind)
      return { items, total: items.length, hasMore: false }
    }),
    getSession: vi.fn(async (id: string) => sessions.find((s) => s.id === id)),
  }
  const relationships = { list: vi.fn(async () => opts.cloned ?? []) }
  const handlers = new Map<string, Handler<never>>()
  const handle: Handle = (channel, fn) => {
    handlers.set(channel, fn as Handler<never>)
  }
  const logger = { child: () => logger, warn: vi.fn() }
  registerCloneIpc({ logger, relationships, substrate, clone: {}, kernel: {}, records: {}, models: {} } as unknown as AppContext, {} as HostBridge, handle)
  const invoke = <K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> =>
    (handlers.get(channel) as unknown as (req: InvokeReq<K>) => Promise<InvokeRes<K>>)(req)
  return { invoke, substrate }
}

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
    expect(list[0]).toMatchObject({ displayName: '阿星', status: { state: 'none', messageCount: 1284 }, lastContactAt: 5 })
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
    const { invoke } = setup({ sessionsThrow: true, cloned: [{ contactId: 'wxid_a', displayName: '阿星', status: READY }] })
    const list = await invoke('clone:list', undefined)
    expect(list.map((e) => e.contactId)).toEqual(['wxid_a'])
  })
})
