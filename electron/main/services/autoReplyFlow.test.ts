import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelClient, SubstrateService, WxMessage } from '@aiwc/protocol'
import { createAutoReplyRecordStore, createAutoReplyService, createGateway, createUiInjectSender } from '@aiwc/gateway'
import { createAutoReplyMonitor } from './autoReplyMonitor'
import { createAutoReplyGenerator } from './autoReplyGenerate'

afterEach(() => vi.useRealTimers())
describe('local auto-reply integration', () => {
  it('observes new DB messages, gates, generates, counts down, sends and verifies before recording success', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 8, 10))
    let seq = 0
    const messages: WxMessage[] = []
    const add = (text: string, isSelf = false) => {
      const id = String(++seq)
      messages.push({ id, seq, sessionId: 'alice', createdAt: Date.now(), senderId: isSelf ? 'owner' : 'alice', isSelf, text, kind: 'text', anchor: { sessionId: 'alice', messageId: id, seq, createdAt: Date.now() } })
    }
    add('历史消息')
    const substrate = {
      status: () => ({ connection: 'ready', account: { wxid: 'owner' }, sync: { phase: 'idle' } }),
      getSession: async () => ({ id: 'alice', title: 'Alice', kind: 'dm' }),
      listMessages: async (q: { limit: number; from?: number }) => ({ items: messages.filter((m) => !q.from || m.createdAt >= q.from).slice(-q.limit), hasMore: false }),
      listSessions: async () => ({ items: [], hasMore: false, total: 0 }),
      subscribe: () => () => {},
    } as unknown as SubstrateService
    const records = createAutoReplyRecordStore({ dbPath: ':memory:' })
    records.saveRule({ id: 'r', accountId: 'owner', sessionId: 'alice', enabled: true, source: 'ai', historyCount: 30, updatedAt: Date.now() })
    const gateway = createGateway({ rules: async () => records.listRules(), isAllowed: (source) => source.channel === 'wechat-ui' })
    let filled = ''
    const commits = vi.fn(async () => add(filled, true))
    const sender = createUiInjectSender({ substrate, platform: 'darwin', injector: { focusSession: async () => {}, fill: async (text) => { filled = text }, commit: commits }, verifyPollMs: 1, segmentGapMs: [0, 0], itemGapMs: [0, 0] })
    gateway.registerAdapter(sender.asAdapter())
    const model = { ref: { supportsVision: false }, async *sample() { yield { type: 'text.delta' as const, delta: '明天聊' } } } as ModelClient
    const generate = createAutoReplyGenerator({ substrate, model: async () => model })
    const service = createAutoReplyService({ gateway, records, generate: (event, rule, ctx) => generate(event, rule, ctx.signal), countdownMs: () => 2000, onDraft: () => {} })
    const monitor = createAutoReplyMonitor({ substrate, rules: () => records.listRules(), enabled: () => true, ingest: gateway.ingest, invalidate: service.invalidate, accountChanged: () => service.halt('账户变化'), pollMs: 100000, quietMs: 5000 })
    service.start(); monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(records.listDrafts()).toEqual([])
    add('明天什么时候聊？'); await monitor.refresh()
    await vi.advanceTimersByTimeAsync(5000)
    expect(records.listDrafts(['pending'])[0]?.draft).toBe('明天聊')
    expect(commits).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2001)
    expect(commits).toHaveBeenCalledTimes(1)
    expect(records.listRecords()[0]).toMatchObject({ status: 'sent', replyText: '明天聊' })
    expect(records.countToday('alice')).toBe(1)
    await monitor.refresh(); await vi.advanceTimersByTimeAsync(10000)
    expect(commits).toHaveBeenCalledTimes(1)
    monitor.stop(); service.stop(); await gateway.shutdown(); records.close()
  })
})
