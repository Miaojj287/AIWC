import { describe, expect, it, vi } from 'vitest'
import type { AutoReplyRule, GatewayEvent, GatewayOutbound, MessageEvent, ReplyDecision, SendRequest, SendResult } from '@aiwc/protocol'
import { createGateway } from './gateway'
import { withOriginGuard } from './originGuard'
import { createFakeAdapter, fakeEvent } from '../testing/fakeAdapter'

const flush = () => new Promise((r) => setTimeout(r, 0))

const rule = (sessionId: string, over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: `r_${sessionId}`,
  sessionId,
  enabled: true,
  source: 'fixed',
  fixedText: '收到',
  historyCount: 30,
  updatedAt: 0,
  ...over,
})

function setup(opts: { rules?: AutoReplyRule[] | (() => AutoReplyRule[]); isAllowed?: (s: { channel: string; peerId: string }) => boolean } = {}) {
  const gw = createGateway({
    rules: async () => (typeof opts.rules === 'function' ? opts.rules() : opts.rules ?? []),
    isAllowed: opts.isAllowed,
  })
  const ilink = createFakeAdapter('wechat-ilink', { mentionPatterns: ['@AIWC'], supportsQr: true })
  const desktop = createFakeAdapter('desktop')
  const ui = createFakeAdapter('wechat-ui')
  gw.registerAdapter(ilink)
  gw.registerAdapter(desktop)
  gw.registerAdapter(ui)
  const inbound: Array<{ event: MessageEvent; decision: ReplyDecision; key: string }> = []
  gw.onInbound((event, decision, key) => {
    inbound.push({ event, decision, key })
  })
  const events: GatewayEvent[] = []
  gw.events.on((e) => events.push(e))
  return { gw, ilink, desktop, ui, inbound, events }
}

describe('gateway core', () => {
  it('connect/disconnect/status go through the registered adapter and emit state events', async () => {
    const { gw, ilink, events } = setup()
    await gw.connect('wechat-ilink')
    expect(ilink.state).toBe('connected')
    expect(gw.status()).toEqual(expect.arrayContaining([{ channel: 'wechat-ilink', state: 'connected', detail: undefined }]))
    ilink.setState('error', '断线')
    expect(gw.status().find((s) => s.channel === 'wechat-ilink')).toEqual({ channel: 'wechat-ilink', state: 'error', detail: '断线' })
    await gw.disconnect('wechat-ilink')
    expect(events.filter((e) => e.type === 'adapter.state').map((e) => (e.type === 'adapter.state' ? e.state : ''))).toEqual(['connected', 'error', 'disconnected'])
    await expect(gw.connect('cron')).rejects.toThrow(/通道未注册/)
  })

  it('surfaces adapter QR codes as login.qr events', () => {
    const { ilink, events } = setup()
    ilink.emitQr('data:image/png;base64,AAA')
    expect(events).toContainEqual({ type: 'login.qr', channel: 'wechat-ilink', qrDataUrl: 'data:image/png;base64,AAA' })
  })

  it('routes inbound through authz → gate → onInbound with a session key', async () => {
    const { gw, ilink, inbound, events } = setup({ rules: [rule('u_alice')] })
    void gw
    ilink.emitMessage(fakeEvent({ id: 'm1', text: '在吗' }))
    await flush()
    expect(inbound).toHaveLength(1)
    expect(inbound[0]?.decision).toEqual({ reply: true, reason: 'ok' })
    expect(inbound[0]?.key).toBe('agent:wechat-ilink:dm:u_alice')
    expect(events.some((e) => e.type === 'inbound' && e.event.id === 'm1')).toBe(true)
  })

  it('denies unknown channels silently by default and allows desktop + wechat-ilink', async () => {
    const { ilink, desktop, ui, inbound, events } = setup()
    ui.emitMessage(fakeEvent({ id: 'ui1', source: { channel: 'wechat-ui' } }))
    desktop.emitMessage(fakeEvent({ id: 'd1', source: { channel: 'desktop', peerId: 'me', chatId: 'me' } }))
    ilink.emitMessage(fakeEvent({ id: 'i1' }))
    await flush()
    expect(inbound.map((i) => i.event.id).sort()).toEqual(['d1', 'i1'])
    expect(events.filter((e) => e.type === 'inbound')).toHaveLength(2)
  })

  it('honours a custom allow-list and lets internal events bypass it', async () => {
    const { ilink, inbound } = setup({ isAllowed: (s) => s.peerId === 'u_bob' })
    ilink.emitMessage(fakeEvent({ id: 'a' }))
    ilink.emitMessage(fakeEvent({ id: 'b', source: { peerId: 'u_bob', chatId: 'u_bob' } }))
    ilink.emitMessage(fakeEvent({ id: 'c', internal: true }))
    await flush()
    expect(inbound.map((i) => i.event.id)).toEqual(['b', 'c'])
  })

  it('observes group chatter a rule does not cover and replays it as a fragment once one does', async () => {
    // Buffering is what a group WITHOUT auto-reply gets: the messages still reach the Agent as
    // context. Turning the rule on later drains the buffer into the reply that finally happens.
    let rules: AutoReplyRule[] = []
    const { gw, ilink, inbound } = setup({ rules: () => rules })
    const group = { channel: 'wechat-ilink' as const, chatId: 'g1@chatroom', chatType: 'group' as const }
    ilink.emitMessage(fakeEvent({ id: '1', text: '今天开会吗', addressed: false, source: { ...group, peerId: 'u1', displayName: '王伟' } }))
    ilink.emitMessage(fakeEvent({ id: '2', text: '下午三点', addressed: false, source: { ...group, peerId: 'u2', displayName: '张明' } }))
    await flush()
    expect(inbound.map((i) => i.decision)).toEqual([
      { reply: false, observe: true, reason: 'no_rule' },
      { reply: false, observe: true, reason: 'no_rule' },
    ])
    expect(gw.observed.size('g1@chatroom')).toBe(2)
    const frag = gw.observed.fragment('g1@chatroom')
    expect(frag?.render()).toContain('[王伟|u1] 今天开会吗\n[张明|u2] 下午三点')

    rules = [rule('g1@chatroom')]
    ilink.emitMessage(fakeEvent({ id: '3', text: '@AIWC 帮我总结', addressed: false, source: { ...group, peerId: 'u1' } }))
    await flush()
    expect(inbound[2]?.decision).toEqual({ reply: true, reason: 'ok' })
    expect(inbound[2]?.key).toBe('agent:wechat-ilink:group:g1@chatroom:u1')
    // the addressed message itself is not buffered
    expect(gw.observed.take('g1@chatroom').map((e) => e.id)).toEqual(['1', '2'])
    expect(gw.observed.size('g1@chatroom')).toBe(0)
  })

  it('does not buffer DM misses and keeps serving handlers when one throws', async () => {
    const { gw, ilink, inbound } = setup({ rules: [] })
    gw.onInbound(() => {
      throw new Error('boom')
    })
    const seen: string[] = []
    gw.onInbound((e) => {
      seen.push(e.id)
    })
    ilink.emitMessage(fakeEvent({ id: 'x' }))
    await flush()
    expect(inbound[0]?.decision).toEqual({ reply: false, observe: true, reason: 'no_rule' })
    expect(gw.observed.size('u_alice')).toBe(0) // DM misses are never buffered
    expect(seen).toEqual(['x'])
  })

  it('routes outbound by channel and reports unknown channels / empty parts / adapter throws', async () => {
    const { gw, ilink, events } = setup()
    const to = fakeEvent().source
    const ok = await gw.outbound.send({ to, parts: [{ type: 'text', text: 'hi' }], reason: 'agent_tool' })
    expect(ok.ok).toBe(true)
    expect(ilink.sent).toHaveLength(1)

    const unknown = await gw.outbound.send({ to: { ...to, channel: 'cron' }, parts: [{ type: 'text', text: 'x' }], reason: 'cron' })
    expect(unknown).toMatchObject({ ok: false, error: expect.stringContaining('通道未注册') })

    const empty = await gw.outbound.send({ to, parts: [], reason: 'agent_tool' })
    expect(empty.ok).toBe(false)

    ilink.sendImpl = async () => {
      throw new Error('network down')
    }
    const failed = await gw.outbound.send({ to, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })
    expect(failed).toEqual({ ok: false, error: 'network down' })
    expect(events.filter((e) => e.type === 'outbound')).toHaveLength(4)
  })

  it('replaces an adapter registered twice for the same channel', async () => {
    const { gw, ilink, inbound } = setup()
    const replacement = createFakeAdapter('wechat-ilink')
    gw.registerAdapter(replacement)
    ilink.emitMessage(fakeEvent({ id: 'old' }))
    replacement.emitMessage(fakeEvent({ id: 'new' }))
    await flush()
    expect(inbound.map((i) => i.event.id)).toEqual(['new'])
    gw.unregisterAdapter('wechat-ilink')
    expect(gw.status().map((s) => s.channel)).not.toContain('wechat-ilink')
  })

  it('shutdown disconnects connected adapters', async () => {
    const { gw, ilink } = setup()
    await gw.connect('wechat-ilink')
    await gw.shutdown()
    expect(ilink.state).toBe('disconnected')
    expect(gw.status()).toEqual([])
  })
})

describe('withOriginGuard', () => {
  const sendSpy = () => {
    const calls: SendRequest[] = []
    const outbound: GatewayOutbound & { send: ReturnType<typeof vi.fn> } = {
      send: vi.fn(async (req: SendRequest): Promise<SendResult> => {
        calls.push(req)
        return { ok: true }
      }),
    }
    return { outbound, calls }
  }

  it('forces the target to the origin chat on wechat channels regardless of `to`', async () => {
    const { outbound, calls } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'wechat-ilink', chatId: 'u_owner' })
    await guarded.send({ to: { channel: 'wechat-ilink', chatId: 'u_victim', peerId: 'u_victim', chatType: 'dm' }, parts: [{ type: 'text', text: 'secret' }], reason: 'agent_tool' })
    expect(calls[0]?.to).toEqual({ channel: 'wechat-ilink', chatId: 'u_owner', peerId: 'u_owner', chatType: 'dm' })
    // a different channel is also rewritten back to the origin channel
    await guarded.send({ to: { channel: 'wechat-ui', chatId: 'x', peerId: 'x', chatType: 'dm' }, parts: [{ type: 'text', text: 'y' }], reason: 'agent_tool' })
    expect(calls[1]?.to.channel).toBe('wechat-ilink')
    expect(calls[1]?.to.chatId).toBe('u_owner')
  })

  it('keeps the richer source when the request already targets the origin', async () => {
    const { outbound, calls } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'wechat-ilink', chatId: 'g1@chatroom' })
    const to = { channel: 'wechat-ilink' as const, chatId: 'g1@chatroom', peerId: 'u1', chatType: 'group' as const, displayName: '产品群' }
    await guarded.send({ to, parts: [{ type: 'text', text: 'ok' }], reason: 'auto_reply' })
    expect(calls[0]?.to).toEqual(to)
  })

  it('infers group chat type from the @chatroom suffix', async () => {
    const { outbound, calls } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'wechat-ilink', chatId: 'g1@chatroom' })
    await guarded.send({ to: { channel: 'wechat-ilink', chatId: 'other', peerId: 'other', chatType: 'dm' }, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })
    expect(calls[0]?.to.chatType).toBe('group')
  })

  it('refuses to send when the wechat origin has no chatId', async () => {
    const { outbound } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'wechat-ilink' })
    const res = await guarded.send({ to: { channel: 'wechat-ilink', chatId: 'x', peerId: 'x', chatType: 'dm' }, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })
    expect(res.ok).toBe(false)
    expect(outbound.send).not.toHaveBeenCalled()
  })

  it('passes desktop / cron origins through untouched', async () => {
    const { outbound, calls } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'desktop' })
    const to = { channel: 'wechat-ui' as const, chatId: 'u_bob', peerId: 'u_bob', chatType: 'dm' as const }
    await guarded.send({ to, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })
    expect(calls[0]?.to).toEqual(to)
    expect(withOriginGuard(outbound, undefined)).toBe(outbound)
  })

  it("treats an 'observed' origin as a bot origin: `to` is rewritten to the origin chat on the UI channel", async () => {
    const { outbound, calls } = sendSpy()
    const guarded = withOriginGuard(outbound, { channel: 'observed', chatId: 'wxid_owner' })
    await guarded.send({ to: { channel: 'wechat-ilink', chatId: 'u_victim', peerId: 'u_victim', chatType: 'dm' }, parts: [{ type: 'text', text: 'secret' }], reason: 'agent_tool' })
    expect(calls[0]?.to).toEqual({ channel: 'wechat-ui', chatId: 'wxid_owner', peerId: 'wxid_owner', chatType: 'dm' })
    // 'observed' has no adapter of its own: a request already aimed at the origin chat on the UI channel is kept as-is
    const to = { channel: 'wechat-ui' as const, chatId: 'wxid_owner', peerId: 'wxid_owner', chatType: 'dm' as const, displayName: 'Owner' }
    await guarded.send({ to, parts: [{ type: 'text', text: 'ok' }], reason: 'agent_tool' })
    expect(calls[1]?.to).toEqual(to)
    // without a chatId the observed origin refuses, exactly like a wechat origin
    const res = await withOriginGuard(outbound, { channel: 'observed' }).send({ to, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(2)
  })
})
