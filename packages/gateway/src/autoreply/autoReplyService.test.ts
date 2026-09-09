import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoReplyRecord, AutoReplyRule, GatewayEvent, MessageEvent, ReplyDraft, SendRequest, SendResult, SessionKey } from '@aiwc/protocol'
import { createAutoReplyService, type AutoReplyServiceDeps } from './autoReplyService'
import { createAutoReplyRecordStore } from './recordStore'
import { substituteTemplate, templateVars } from './template'
import { createGateway } from '../core/gateway'
import { createFakeAdapter, fakeEvent } from '../testing/fakeAdapter'

const rule = (sessionId: string, over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: `r_${sessionId}`,
  sessionId,
  enabled: true,
  source: 'fixed',
  fixedText: '{昵称}你好，已收到消息，稍后回复（{时间}）',
  historyCount: 30,
  updatedAt: 0,
  ...over,
})

const KEY = 'agent:wechat-ilink:dm:u_alice' as SessionKey

function setup(opts: { rules?: AutoReplyRule[]; countdownMs?: number; generate?: AutoReplyServiceDeps['generate']; sendImpl?: (req: SendRequest) => Promise<SendResult>; supportsRecall?: boolean } = {}) {
  const records = createAutoReplyRecordStore({ dbPath: ':memory:' })
  for (const r of opts.rules ?? [rule('u_alice')]) records.saveRule(r)
  const sent: SendRequest[] = []
  const gateway = {
    onInbound: vi.fn(() => () => {}),
    outbound: {
      send: async (req: SendRequest): Promise<SendResult> => {
        sent.push(req)
        return opts.sendImpl ? opts.sendImpl(req) : { ok: true, messageId: `m${sent.length}` }
      },
    },
    emit: vi.fn(),
  }
  const drafts: ReplyDraft[] = []
  const recs: AutoReplyRecord[] = []
  const events: GatewayEvent[] = []
  const service = createAutoReplyService({
    gateway,
    records,
    countdownMs: () => opts.countdownMs ?? 5000,
    onDraft: (d) => drafts.push(d),
    onRecord: (r) => recs.push(r),
    generate: opts.generate ?? (async () => 'AI 草稿'),
    supportsRecall: () => opts.supportsRecall ?? false,
  })
  service.events.on((e) => events.push(e))
  const lastDraft = () => drafts[drafts.length - 1]
  return { service, records, gateway, sent, drafts, recs, events, lastDraft }
}

const ev = (over: Partial<MessageEvent> = {}) => fakeEvent({ id: 'trig_1', text: '请问报价多少', timestamp: 1_700_000_000_000, raw: { context_token: 'ctx-1' }, ...over })

describe('template substitution', () => {
  it('fills {昵称}{时间}{群名}', () => {
    const e = ev({ source: { channel: 'wechat-ilink', peerId: 'u1', chatId: 'g1@chatroom', chatType: 'group', displayName: '王伟' } })
    const vars = templateVars(e, { groupName: '产品群' }, new Date(2026, 8, 7, 9, 5).getTime())
    expect(vars).toEqual({ nickname: '王伟', time: '09:05', groupName: '产品群' })
    expect(substituteTemplate('{群名}·{昵称}·{时间}·{未知}', vars)).toBe('产品群·王伟·09:05·{未知}')
  })
})

describe('createAutoReplyService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 7, 10, 30))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves a held draft and its audit/context across a graceful restart', async () => {
    const h = setup()
    h.service.start()
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    const draft = h.lastDraft()
    h.service.hold(draft.id) // the reply desk's "wait, let me look at it"
    await h.service.stop()
    expect(h.records.getDraft(draft.id)?.state).toBe('pending')
    const next = createAutoReplyService({ gateway: h.gateway, records: h.records, countdownMs: () => 5000, generate: async () => 'unused', onDraft: () => {} })
    next.start()
    await next.resolveDraft(draft.id, 'approve')
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].contextToken).toBe('ctx-1')
    expect(h.records.getRecord(draft.recordId!)?.status).toBe('sent')
    await next.stop()
    h.records.close()
  })

  it('waits for an aborted generation before allowing the record store to close', async () => {
    const h = setup({ rules: [rule('u_alice', { source: 'ai' })], generate: async (_event, _rule, context) => new Promise((_resolve, reject) => {
      context.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    const generation = h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await h.service.stop()
    await generation
    expect(h.records.listDrafts()).toHaveLength(0)
    expect(h.recs.at(-1)?.status).toBe('rejected')
    h.records.close()
  })

  it('auto mode: fixed text with variables → countdown → send → records sent', async () => {
    const { service, sent, drafts, recs, events, records } = setup({ countdownMs: 3000 })
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ state: 'pending', mode: 'auto', draft: 'Alice你好，已收到消息，稍后回复（10:30）', countdownEndsAt: Date.now() + 3000 })
    expect(events[0]).toEqual({ type: 'autoreply.queued', draftId: drafts[0]!.id })
    expect(events[1]).toEqual({ type: 'autoreply.countdown', draftId: drafts[0]!.id, remainingMs: 3000 })
    expect(recs[0]).toMatchObject({ status: 'pending', triggerMessage: { id: 'trig_1', text: '请问报价多少' } })
    expect(sent).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(events.filter((e) => e.type === 'autoreply.countdown').map((e) => (e.type === 'autoreply.countdown' ? e.remainingMs : -1))).toEqual([3000, 2000, 1000])
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ reason: 'auto_reply', contextToken: 'ctx-1', to: { chatId: 'u_alice' }, parts: [{ type: 'text', text: 'Alice你好，已收到消息，稍后回复（10:30）' }] })
    expect(drafts.map((d) => d.state)).toEqual(['pending', 'sending', 'sent'])
    const rec = records.listRecords({ sessionId: 'u_alice' })[0]!
    expect(rec.status).toBe('sent')
    expect(rec.recallableUntil).toBeUndefined() // iLink does not support recall
    expect(records.getRule('u_alice')?.todayCount).toBe(1)
    expect(service.listDrafts()[0]?.state).toBe('sent')
  })

  it('sets recallableUntil = +2min when the channel supports recall', async () => {
    const { service, records } = setup({ countdownMs: 0, supportsRecall: true })
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    const rec = records.listRecords()[0]!
    expect(rec.status).toBe('sent')
    expect(rec.recallableUntil).toBe(Date.now() + 120_000)
    expect(await service.recall(rec.id)).toMatchObject({ ok: false, error: expect.stringContaining('不支持撤回') })
    vi.setSystemTime(Date.now() + 200_000)
    expect(await service.recall(rec.id)).toEqual({ ok: false, error: '已超过 2 分钟撤回时限' })
  })

  it('a held draft waits for approve / reject / edit', async () => {
    const { service, sent, drafts, records } = setup({ rules: [rule('u_alice', { source: 'ai' })] })
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    service.hold(drafts[0]!.id)
    expect(drafts.at(-1)).toMatchObject({ state: 'pending', mode: 'confirm', draft: 'AI 草稿', expiresAt: Date.now() + 30 * 60_000 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(0)

    await service.resolveDraft(drafts[0]!.id, 'approve')
    expect(sent).toHaveLength(1)
    await expect(service.resolveDraft(drafts[0]!.id, 'approve')).rejects.toThrow(/不存在|已处理/)

    await service.handle(ev({ id: 'trig_2' }), { reply: true, reason: 'ok' }, KEY)
    const second = drafts[drafts.length - 1]!
    service.hold(second.id)
    await service.resolveDraft(second.id, 'reject')
    expect(sent).toHaveLength(1)
    expect(records.listRecords({ status: 'rejected' })).toHaveLength(1)

    await service.handle(ev({ id: 'trig_3' }), { reply: true, reason: 'ok' }, KEY)
    const third = drafts[drafts.length - 1]!
    service.hold(third.id)
    await expect(service.resolveDraft(third.id, 'edit', '   ')).rejects.toThrow(/不能为空/)
    await service.resolveDraft(third.id, 'edit', '改过的回复\n---wx-next---\n第二条')
    expect(sent[1]?.parts).toEqual([
      { type: 'text', text: '改过的回复' },
      { type: 'text', text: '第二条' },
    ])
    expect(records.listRecords({ status: 'sent' }).find((r) => r.triggerMessage.id === 'trig_3')?.replyText).toBe('改过的回复\n---wx-next---\n第二条')
  })

  it('no rule / rule disabled / decision reply=false → nothing happens', async () => {
    const disabled = setup({ rules: [rule('u_alice', { enabled: false })] })
    await disabled.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(disabled.drafts).toHaveLength(0)
    const none = setup({ rules: [] })
    await none.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(none.drafts).toHaveLength(0)
    const gated = setup()
    await gated.service.handle(ev(), { reply: false, reason: 'rule_disabled', observe: true }, KEY)
    expect(gated.drafts).toHaveLength(0)
  })

  it('a newer message in the same chat cancels the pending countdown and starts a new one', async () => {
    const { service, sent, drafts, records } = setup({ countdownMs: 5000 })
    await service.handle(ev({ id: 'a', text: '报价' }), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(3000)
    await service.handle(ev({ id: 'b', text: '报价 追问' }), { reply: true, reason: 'ok' }, KEY)
    const first = drafts.find((d) => d.triggerMessageId === 'a' && d.state === 'expired')
    expect(first).toBeDefined()
    expect(first?.error).toContain('取代')
    await vi.advanceTimersByTimeAsync(2000) // the old timer would have fired here
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.parts[0]).toMatchObject({ type: 'text' })
    expect(records.listRecords({ status: 'rejected' })).toHaveLength(1)
    expect(records.listRecords({ status: 'sent' })).toHaveLength(1)
  })

  it('same trigger delivered twice is handled once', async () => {
    const { service, drafts } = setup()
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(drafts.filter((d) => d.state === 'pending')).toHaveLength(1)
  })

  it('cancel() rejects a pending draft; different chats do not supersede each other', async () => {
    const { service, sent, drafts, records } = setup({ countdownMs: 1000, rules: [rule('u_alice'), rule('u_bob')] })
    await service.handle(ev({ id: 'a' }), { reply: true, reason: 'ok' }, KEY)
    const bob = ev({ id: 'b', source: { channel: 'wechat-ilink', peerId: 'u_bob', chatId: 'u_bob', chatType: 'dm', displayName: 'Bob' } })
    await service.handle(bob, { reply: true, reason: 'ok' }, 'agent:wechat-ilink:dm:u_bob' as SessionKey)
    expect(drafts.filter((d) => d.state === 'pending')).toHaveLength(2)

    service.cancel(drafts[0]!.id)
    expect(drafts.at(-1)).toMatchObject({ triggerMessageId: 'a', state: 'rejected', error: '已取消' })
    service.cancel(drafts[0]!.id) // no-op on a settled draft
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to.chatId).toBe('u_bob')
    expect(records.listRecords({ status: 'rejected' })).toHaveLength(1)
    expect(records.listRecords({ status: 'sent' })).toHaveLength(1)
  })

  it('halt() stops everything (pending auto drafts expire, inbound ignored) until resume()', async () => {
    const { service, sent, drafts, events } = setup({ countdownMs: 2000 })
    await service.handle(ev({ id: 'a' }), { reply: true, reason: 'ok' }, KEY)
    service.halt('UI 注入校验失败')
    expect(service.halted).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'autoreply.halted', reason: 'UI 注入校验失败' })
    expect(drafts.at(-1)).toMatchObject({ state: 'expired', error: expect.stringContaining('熔断') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toHaveLength(0)
    await service.handle(ev({ id: 'b' }), { reply: true, reason: 'ok' }, KEY)
    expect(drafts.filter((d) => d.triggerMessageId === 'b')).toHaveLength(0)

    service.resume()
    await service.handle(ev({ id: 'c' }), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toHaveLength(1)
  })

  it('a failed attempt leaves the message answerable: the same trigger can be tried again', async () => {
    // One "Insufficient Balance" used to latch that chat forever — the peer still had the last
    // word, but every later attempt was swallowed as "already seen".
    let fail = true
    const h = setup({
      rules: [rule('u_alice', { source: 'ai' })],
      countdownMs: 0,
      generate: async () => {
        if (fail) throw new Error('Insufficient Balance')
        return '好的'
      },
    })
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(h.drafts.at(-1)).toMatchObject({ state: 'failed', error: 'Insufficient Balance' })
    expect(h.sent).toHaveLength(0)

    fail = false
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(1)
    h.service.stop(); h.records.close()
  })

  it('a successful attempt stays latched, so a redelivered trigger never double-sends', async () => {
    const h = setup({ countdownMs: 0 })
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(1)
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(1)
    // …unless the user explicitly asks for it again.
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY, { force: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.sent).toHaveLength(2)
    h.service.stop(); h.records.close()
  })

  it('generation failure → failed draft + failed record, no send', async () => {
    const { service, sent, drafts, records } = setup({
      rules: [rule('u_alice', { source: 'ai' })],
      generate: async () => {
        throw new Error('模型超时')
      },
    })
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(drafts[0]).toMatchObject({ state: 'failed', error: '模型超时' })
    expect(records.listRecords()[0]).toMatchObject({ status: 'failed', error: '模型超时' })
    expect(sent).toHaveLength(0)
  })

  it('send failure marks failed; a verified-channel failure also halts the service', async () => {
    const plain = setup({ countdownMs: 0, sendImpl: async () => ({ ok: false, error: '网络错误' }) })
    await plain.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(plain.drafts.at(-1)).toMatchObject({ state: 'failed', error: '网络错误' })
    expect(plain.records.listRecords()[0]?.status).toBe('failed')
    expect(plain.service.halted).toBe(false)

    const verified = setup({ countdownMs: 0, sendImpl: async () => ({ ok: false, verified: false, error: '发到了别的会话' }) })
    await verified.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(verified.service.halted).toBe(true)
    expect(verified.service.haltReason).toBe('发到了别的会话')
  })

  it('passes the session key and abort signal to generate', async () => {
    const keys: SessionKey[] = []
    const { service, drafts } = setup({
      rules: [rule('u_alice', { source: 'ai' })],
      countdownMs: 0,
      generate: async (_e, _r, c) => {
        keys.push(c.sessionKey)
        expect(c.signal).toBeInstanceOf(AbortSignal)
        return '晚点回你'
      },
    })
    await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    expect(keys).toEqual([KEY])
    expect(drafts[0]?.draft).toBe('晚点回你')
  })

  describe('enqueueDraft', () => {
    const handoff = (over: Partial<ReplyDraft> = {}): ReplyDraft => ({
      id: 'drf_handoff',
      source: { channel: 'wechat-ilink', chatId: 'u_alice', peerId: 'u_alice', chatType: 'dm' },
      triggerMessageId: '',
      triggerText: '',
      draft: 'Agent 起草的回复',
      state: 'pending',
      createdAt: Date.now(),
      mode: 'suggest',
      ...over,
    })

    it('persists the draft, makes it live at once, and approve/edit sends it to draft.source', async () => {
      const { service, records, drafts, events, sent, recs } = setup()
      service.enqueueDraft(handoff())
      expect(records.getDraft('drf_handoff')).toMatchObject({ state: 'pending', mode: 'suggest' })
      expect(drafts.at(-1)).toMatchObject({ id: 'drf_handoff', state: 'pending' })
      expect(events.at(-1)).toEqual({ type: 'autoreply.queued', draftId: 'drf_handoff' })
      expect(service.listDrafts().map((d) => d.id)).toContain('drf_handoff')

      await service.resolveDraft('drf_handoff', 'edit', '改一下再发')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ to: handoff().source, reason: 'auto_reply', parts: [{ type: 'text', text: '改一下再发' }] })
      expect(records.getDraft('drf_handoff')?.state).toBe('sent')
      // a handoff has no AutoReplyRecord of its own; the gateway outbound event is its audit trail
      expect(recs).toHaveLength(0)
      await expect(service.resolveDraft('drf_handoff', 'approve')).rejects.toThrow(/不存在|已处理/)
    })

    it('is idempotent, rejects non-pending drafts and supports cancel()', () => {
      const { service, records, drafts } = setup()
      service.enqueueDraft(handoff())
      service.enqueueDraft(handoff())
      expect(drafts.filter((d) => d.id === 'drf_handoff')).toHaveLength(1)
      expect(() => service.enqueueDraft(handoff({ id: 'drf_sent', state: 'sent' }))).toThrow(/待处理/)
      expect(records.getDraft('drf_sent')).toBeUndefined()
      service.cancel('drf_handoff')
      expect(records.getDraft('drf_handoff')).toMatchObject({ state: 'rejected', error: '已取消' })
    })

    it('one pending draft per chat: enqueue supersedes the pending one, a newer inbound supersedes the enqueued one', async () => {
      const { service, records, drafts, sent } = setup({ countdownMs: 60_000 })
      await service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
      const first = drafts.at(-1)!
      service.enqueueDraft(handoff())
      expect(records.getDraft(first.id)).toMatchObject({ state: 'expired', error: expect.stringContaining('新草稿') })
      await service.handle(ev({ id: 'trig_2' }), { reply: true, reason: 'ok' }, KEY)
      expect(records.getDraft('drf_handoff')).toMatchObject({ state: 'expired', error: expect.stringContaining('新消息') })
      const second = drafts.filter((d) => d.triggerMessageId === 'trig_2').at(-1)!
      service.enqueueDraft(handoff({ id: 'drf_bob', source: { channel: 'wechat-ilink', chatId: 'u_bob', peerId: 'u_bob', chatType: 'dm' } }))
      expect(records.getDraft(second.id)?.state).toBe('pending') // another chat does not interfere
      expect(sent).toHaveLength(0)
    })

    it('auto-mode drafts get a countdown and fire; while halted they expire and approved drafts fail', async () => {
      const { service, records, sent, events } = setup({ countdownMs: 3000 })
      service.enqueueDraft(handoff({ id: 'drf_auto', mode: 'auto' }))
      expect(records.getDraft('drf_auto')).toMatchObject({ state: 'pending', countdownEndsAt: Date.now() + 3000 })
      expect(events.some((e) => e.type === 'autoreply.countdown' && e.draftId === 'drf_auto')).toBe(true)
      await vi.advanceTimersByTimeAsync(3000)
      expect(sent).toHaveLength(1)
      expect(records.getDraft('drf_auto')?.state).toBe('sent')

      service.halt('UI 注入校验失败')
      service.enqueueDraft(handoff({ id: 'drf_auto2', mode: 'auto' }))
      expect(records.getDraft('drf_auto2')).toMatchObject({ state: 'expired', error: expect.stringContaining('熔断') })
      await vi.advanceTimersByTimeAsync(5000)
      expect(sent).toHaveLength(1)
      service.enqueueDraft(handoff({ id: 'drf_confirm', mode: 'confirm' }))
      await expect(service.resolveDraft('drf_confirm', 'approve')).rejects.toThrow('UI 注入校验失败')
      expect(records.getDraft('drf_confirm')).toMatchObject({ state: 'failed', error: 'UI 注入校验失败' })
      expect(sent).toHaveLength(1)
    })
  })

  it('drops an old generation when a newer message arrives before the model finishes', async () => {
    let finish!: (text: string) => void
    let calls = 0
    const h = setup({ rules: [rule('u_alice', { source: 'ai' })], generate: () => ++calls === 1 ? new Promise((resolve) => { finish = resolve }) : Promise.resolve('新回复') })
    const first = h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    await Promise.resolve()
    await h.service.handle(ev({ id: 'new', text: '补充问题' }), { reply: true, reason: 'ok' }, KEY)
    finish('已过时的回复'); await first
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.parts).toEqual([{ type: 'text', text: '新回复' }])
    h.service.stop(); h.records.close()
  })

  it('holding a countdown makes the draft editable and prevents automatic sending', async () => {
    const h = setup()
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    const id = h.lastDraft()!.id
    h.service.hold(id)
    await vi.advanceTimersByTimeAsync(10000)
    expect(h.sent).toEqual([])
    await h.service.resolveDraft(id, 'edit', '修改后的回复')
    expect(h.sent[0]?.parts).toEqual([{ type: 'text', text: '修改后的回复' }])
    h.service.stop(); h.records.close()
  })

  it('reports send failure to the caller, and can retry an ordinary network failure', async () => {
    let attempts = 0
    const h = setup({ sendImpl: async () => ++attempts === 1 ? { ok: false, error: 'offline' } : { ok: true } })
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    const id = h.lastDraft()!.id
    h.service.hold(id)
    await expect(h.service.resolveDraft(id, 'approve')).rejects.toThrow('offline')
    await h.service.retry(id)
    expect(h.records.getDraft(id)?.state).toBe('sent')
    expect(h.records.listRecords()[0]?.status).toBe('sent')
    h.service.stop(); h.records.close()
  })

  it('does not send expired approvals even without opening the reply desk', async () => {
    const h = setup()
    await h.service.handle(ev(), { reply: true, reason: 'ok' }, KEY)
    const id = h.lastDraft()!.id
    h.service.hold(id)
    await vi.advanceTimersByTimeAsync(31 * 60000)
    await expect(h.service.resolveDraft(id, 'approve')).rejects.toThrow('已过期')
    expect(h.sent).toEqual([])
    h.service.stop(); h.records.close()
  })

  it('start() subscribes to the gateway and expires stale auto drafts from a previous run', async () => {
    const records = createAutoReplyRecordStore({ dbPath: ':memory:' })
    records.saveRule(rule('u_alice'))
    records.saveDraft({ id: 'old_auto', source: ev().source, triggerMessageId: 'x', triggerText: 'x', draft: 'x', state: 'pending', createdAt: 1, mode: 'auto' })
    records.saveDraft({ id: 'old_confirm', source: ev().source, triggerMessageId: 'y', triggerText: 'y', draft: 'y', state: 'pending', createdAt: 1, mode: 'confirm' })

    const gw = createGateway({ rules: async () => records.listRules() })
    const adapter = createFakeAdapter('wechat-ilink')
    gw.registerAdapter(adapter)
    const drafts: ReplyDraft[] = []
    const gwEvents: GatewayEvent[] = []
    gw.events.on((e) => gwEvents.push(e))
    const service = createAutoReplyService({ gateway: gw, records, countdownMs: () => 0, onDraft: (d) => drafts.push(d), generate: async () => 'x' })
    service.start()
    service.start() // idempotent
    expect(records.getDraft('old_auto')?.state).toBe('expired')
    expect(records.getDraft('old_confirm')?.state).toBe('pending')
    // restored confirm drafts are live again: resolvable without waiting for a fresh inbound
    await service.resolveDraft('old_confirm', 'reject')
    expect(records.getDraft('old_confirm')?.state).toBe('rejected')

    adapter.emitMessage(ev({ id: 'live_1' }))
    await vi.advanceTimersByTimeAsync(10)
    expect(adapter.sent).toHaveLength(1)
    expect(adapter.sent[0]?.parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Alice你好') })
    expect(gwEvents.some((e) => e.type === 'autoreply.queued')).toBe(true)
    expect(gwEvents.some((e) => e.type === 'outbound')).toBe(true)
    service.stop()
    expect(drafts.at(-1)?.state).toBe('sent')
  })
})
