import { describe, expect, it } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import type { SubstrateEvent, SubstrateService, WxSession } from '@aiwc/protocol'
import { serveSubstrate } from './server'
import { createSubstrateClient } from './client'
import { attachPort, isRpcRequest, isRpcResponse, unwrapPortMessage, type HostedService, type PortLike } from './protocol'
import { SubstrateError } from '../shared/errors'

/** Two EventTarget-like endpoints wired together; messages are delivered asynchronously like real ports. */
function fakePortPair(): [PortLike & { listeners: Set<(ev: unknown) => void> }, PortLike & { listeners: Set<(ev: unknown) => void> }] {
  const make = () => {
    const self = {
      listeners: new Set<(ev: unknown) => void>(),
      peer: undefined as (typeof self & PortLike) | undefined,
      started: false,
      postMessage(message: unknown) {
        const peer = self.peer
        if (!peer) return
        queueMicrotask(() => {
          for (const l of peer.listeners) l({ data: JSON.parse(JSON.stringify(message)) })
        })
      },
      addEventListener(_type: 'message', listener: (ev: unknown) => void) {
        self.listeners.add(listener)
      },
      removeEventListener(_type: 'message', listener: (ev: unknown) => void) {
        self.listeners.delete(listener)
      },
      start() {
        self.started = true
      },
    }
    return self
  }
  const a = make()
  const b = make()
  a.peer = b
  b.peer = a
  return [a, b]
}

function stubService(): HostedService & { emit(e: SubstrateEvent): void; calls: string[] } {
  const listeners = new Set<(e: SubstrateEvent) => void>()
  const calls: string[] = []
  const sessions: WxSession[] = [{ id: 'wxid_a', kind: 'dm', title: '阿甲', unread: 0, pinned: false, muted: false }]
  let connection: 'no_config' | 'ready' = 'no_config'
  const svc: SubstrateService & { openWith: HostedService['openWith']; close: HostedService['close'] } = {
    status: () => ({ connection, sync: { phase: 'idle' } }),
    listAccounts: async () => [],
    getAccount: async () => undefined,
    listSessions: async (q) => {
      calls.push(`listSessions:${q.limit}`)
      return { items: sessions, total: 1, hasMore: false }
    },
    getSession: async (id) => sessions.find((s) => s.id === id),
    listMessages: async () => ({ items: [], hasMore: false }),
    getMessage: async () => undefined,
    getContext: async () => [],
    search: async () => [],
    listContacts: async () => ({ items: [], total: 0 }),
    getContact: async () => undefined,
    listGroupMembers: async () => ({ items: [], total: 0 }),
    stats: async (q) => {
      if (q.metric === 'ranking') throw new SubstrateError('not_found', '没有数据')
      return { metric: q.metric, rows: [], total: 0 }
    },
    resolveMedia: async () => undefined,
    sync: async () => {
      throw new Error('boom')
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    openWith: async () => {
      connection = 'ready'
      for (const l of listeners) l({ type: 'connection', state: 'ready' })
    },
    close: async () => {
      connection = 'no_config'
    },
  }
  return Object.assign(svc, {
    calls,
    emit: (e: SubstrateEvent) => {
      for (const l of listeners) l(e)
    },
  })
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('host rpc', () => {
  it('publishes the latest account snapshot before notifying connection subscribers', async () => {
    const [serverPort, clientPort] = fakePortPair()
    const svc = stubService()
    let account = { wxid: 'old', dbRoot: '/root', verified: true, avatarPath: 'old.png' }
    svc.status = () => ({ connection: 'ready', sync: { phase: 'idle' }, account })
    const stop = serveSubstrate(svc, serverPort)
    const ch = attachPort(clientPort)
    const client = createSubstrateClient(ch.post, ch.onMessage)
    await tick()
    const observed: string[] = []
    client.subscribe(() => observed.push(client.status().account?.avatarPath ?? 'missing'))
    account = { ...account, wxid: 'new', avatarPath: 'new.png' }
    svc.emit({ type: 'connection', state: 'ready' })
    await tick()
    expect(observed).toEqual(['new.png'])
    client.dispose()
    stop()
  })

  it('round-trips calls, errors, events and status over a fake port pair', async () => {
    const [serverPort, clientPort] = fakePortPair()
    const svc = stubService()
    const stop = serveSubstrate(svc, serverPort)
    const ch = attachPort(clientPort)
    const client = createSubstrateClient(ch.post, ch.onMessage)

    const res = await client.listSessions({ limit: 7 })
    expect(res.items[0]?.title).toBe('阿甲')
    expect(svc.calls).toEqual(['listSessions:7'])
    expect(await client.getSession('wxid_a')).toMatchObject({ id: 'wxid_a' })
    expect(await client.getSession('nope')).toBeUndefined()

    await expect(client.stats({ metric: 'ranking' })).rejects.toMatchObject({ code: 'not_found', message: '没有数据' })
    await expect(client.sync()).rejects.toMatchObject({ code: 'rpc', message: 'boom' })
    // transcribeVoice / querySql are optional on the service → unsupported
    await expect(client.querySql({ db: 'message', sql: 'SELECT 1' })).rejects.toMatchObject({ code: 'unsupported' })

    const received: SubstrateEvent[] = []
    const off = client.subscribe((e) => received.push(e))
    svc.emit({ type: 'messages.changed', sessionIds: ['wxid_a'] })
    await tick()
    expect(received).toEqual([{ type: 'messages.changed', sessionIds: ['wxid_a'] }])

    expect(client.status().connection).toBe('no_config')
    await client.openWith({ dbRoot: '/x', wxid: 'w', dbKeyHex: '', cacheDir: '/c' })
    await tick()
    expect(client.status().connection).toBe('ready')
    expect(received.some((e) => e.type === 'connection')).toBe(true)
    expect((await client.refreshStatus()).connection).toBe('ready')

    off()
    svc.emit({ type: 'sessions.changed' })
    await tick()
    expect(received.filter((e) => e.type === 'sessions.changed')).toHaveLength(0)

    // unknown method is refused by the server allow-list
    let raw: unknown
    const offRaw = ch.onMessage((m) => {
      if (isRpcResponse(m) && m.id === 999) raw = m
    })
    ch.post({ id: 999, method: 'evilMethod', args: [] })
    await tick()
    expect(raw).toMatchObject({ id: 999, ok: false, error: { code: 'unsupported' } })
    offRaw()

    stop()
    client.dispose()
    await expect(client.listSessions({ limit: 1 })).rejects.toMatchObject({ code: 'rpc' })
  })

  it('times out and rejects in-flight calls on dispose', async () => {
    const [, clientPort] = fakePortPair() // nobody is serving
    const ch = attachPort(clientPort)
    const client = createSubstrateClient(ch.post, ch.onMessage, { defaultTimeoutMs: 20 })
    await expect(client.listSessions({ limit: 1 })).rejects.toMatchObject({ code: 'timeout' })
    const pending = client.getAccount()
    client.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'rpc' })
  })

  it('works over a real node MessageChannel (on/off + start duck typing)', async () => {
    const { port1, port2 } = new MessageChannel()
    const svc = stubService()
    const stop = serveSubstrate(svc, port1 as unknown as PortLike)
    const ch = attachPort(port2 as unknown as PortLike)
    const client = createSubstrateClient(ch.post, ch.onMessage)
    const res = await client.listSessions({ limit: 3 })
    expect(res.total).toBe(1)
    stop()
    client.dispose()
    port1.close()
    port2.close()
  })

  it('protocol helpers unwrap envelopes and classify messages', () => {
    expect(unwrapPortMessage({ data: { id: 1, method: 'x', args: [] } })).toEqual({ id: 1, method: 'x', args: [] })
    expect(unwrapPortMessage({ id: 1, ok: true, result: null })).toEqual({ id: 1, ok: true, result: null })
    expect(isRpcRequest({ id: 1, method: 'x', args: [] })).toBe(true)
    expect(isRpcRequest({ id: 1, ok: true })).toBe(false)
    expect(isRpcResponse({ id: 1, ok: false, error: { message: 'm' } })).toBe(true)
  })
})
