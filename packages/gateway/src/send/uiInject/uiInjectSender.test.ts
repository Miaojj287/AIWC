import { describe, expect, it } from 'vitest'
import type { GatewayEvent, SendRequest, WxMessage, WxSession } from '@aiwc/protocol'
import { createUiInjectSender } from './uiInjectSender'
import { InjectorError, type WeChatInjector } from './injectors'

/**
 * Fake DB modelled on the real substrate, including the split that matters here: a FILTERED
 * listMessages (`from` / `kinds` / …) is answered from the local mirror alone, while an unfiltered
 * latest page also reaches the live WeChat shards. `mirrorBehind` freezes the mirror so a test can
 * reproduce "the message is in WeChat but the background sync has not caught up yet".
 */
function createFakeSubstrate({ mirrorBehind = false }: { mirrorBehind?: boolean } = {}) {
  const messages = new Map<string, WxMessage[]>()
  const mirrored = new Set<string>()
  const sessions: WxSession[] = []
  let seq = 0
  const addSession = (id: string, title: string, lastMessageAt = 0) => sessions.push({ id, kind: 'dm', title, unread: 0, pinned: false, muted: false, lastMessageAt })
  const addMine = (sessionId: string, text: string, createdAt: number) => {
    const list = messages.get(sessionId) ?? []
    const m: WxMessage = {
      id: `msg_${++seq}`,
      sessionId,
      seq,
      createdAt,
      senderId: 'me',
      isSelf: true,
      kind: 'text',
      text,
      anchor: { sessionId, messageId: `msg_${seq}`, seq, createdAt },
    }
    list.push(m)
    messages.set(sessionId, list)
    if (!mirrorBehind) mirrored.add(m.id)
    const s = sessions.find((x) => x.id === sessionId)
    if (s) s.lastMessageAt = createdAt
    return m
  }
  const substrate = {
    async listMessages(q: { sessionId: string; from?: number; limit: number }) {
      const all = messages.get(q.sessionId) ?? []
      // Filtered → mirror only. Unfiltered → live shards, which also backfill the mirror.
      const visible = q.from === undefined ? all : all.filter((m) => mirrored.has(m.id) && m.createdAt >= q.from!)
      if (q.from === undefined) for (const m of all) mirrored.add(m.id)
      return { items: visible.slice(-q.limit), hasMore: false }
    },
    async listSessions() {
      return { items: sessions, total: sessions.length, hasMore: false }
    },
    async getSession(id: string) {
      return sessions.find((s) => s.id === id)
    },
  }
  return { substrate, addSession, addMine, mirrored }
}

type Step = { op: string; arg?: string }

function createFakeInjector(script: { onCommit?: (n: number) => void; failFill?: InjectorError; failFocus?: Error } = {}) {
  const steps: Step[] = []
  let commits = 0
  const injector: WeChatInjector = {
    async focusSession(name) {
      steps.push({ op: 'focus', arg: name })
      if (script.failFocus) throw script.failFocus
    },
    async fill(text) {
      steps.push({ op: 'fill', arg: text })
      if (script.failFill) throw script.failFill
    },
    async commit() {
      steps.push({ op: 'commit' })
      commits += 1
      script.onCommit?.(commits)
    },
  }
  return { injector, steps, commits: () => commits }
}

function harness(opts: { injector: WeChatInjector; substrate: ReturnType<typeof createFakeSubstrate>['substrate'] }) {
  let clock = 1_000_000
  const events: GatewayEvent[] = []
  const sender = createUiInjectSender({
    substrate: opts.substrate,
    platform: 'darwin',
    injector: opts.injector,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    verifyTimeoutMs: 4000,
    verifyPollMs: 400,
    segmentGapMs: [0, 0],
  })
  sender.events.on((e) => events.push(e))
  return { sender, events, now: () => clock }
}

const req = (text: string, chatId = 'wxid_alice', displayName?: string): SendRequest => ({
  to: { channel: 'wechat-ui', chatId, peerId: chatId, chatType: 'dm', displayName },
  parts: [{ type: 'text', text }],
  reason: 'auto_reply',
})

describe('createUiInjectSender', () => {
  it('fills, commits once and verifies via DB read-back', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    const inj = createFakeInjector({ onCommit: () => db.addMine('wxid_alice', '收到，稍后回复', 1_000_100) })
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })

    const res = await sender.send(req('收到，稍后回复'))
    expect(res).toEqual({ ok: true, verified: true, messageId: 'msg_1' })
    expect(inj.steps).toEqual([{ op: 'focus', arg: 'Alice' }, { op: 'fill', arg: '收到，稍后回复' }, { op: 'commit' }])
    expect(sender.halted).toBe(false)
  })

  it('verifies against the live database, not the lagging local mirror', async () => {
    // The regression this guards: the read-back used to pass `from`, which the substrate answers
    // from its mirror alone. On a big account the background sync needs longer than the verify
    // window, so a message that WAS delivered read as "not sent" and halted the sender — the exact
    // "sometimes it works, sometimes it doesn't" the user saw.
    const db = createFakeSubstrate({ mirrorBehind: true })
    db.addSession('wxid_alice', 'Alice')
    const inj = createFakeInjector({ onCommit: () => db.addMine('wxid_alice', '收到，稍后回复', 1_000_100) })
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })

    const res = await sender.send(req('收到，稍后回复'))
    expect(res).toMatchObject({ ok: true, verified: true })
    expect(inj.commits()).toBe(1) // confirmed on the first Enter; no blind retry needed
    expect(sender.halted).toBe(false)
  })

  it('does not mistake an identical earlier message for proof of a new send', async () => {
    const db = createFakeSubstrate(); db.addSession('wxid_alice', 'Alice')
    db.addMine('wxid_alice', '收到', 999_999)
    const inj = createFakeInjector()
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    const result = await sender.send(req('收到'))
    expect(result).toMatchObject({ ok: false, verified: false })
    expect(sender.halted).toBe(true)
  })

  it('uses the request displayName for the search when given, and sends bubbles with one focus', async () => {
    const db = createFakeSubstrate()
    db.addSession('g1@chatroom', '产品群')
    let clockRef = 0
    const inj = createFakeInjector({
      onCommit: (n) => {
        db.addMine('g1@chatroom', n === 1 ? '第一句' : '第二句', 1_000_000 + n)
        clockRef = n
      },
    })
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    const res = await sender.send({ ...req('第一句\n---wx-next---\n第二句', 'g1@chatroom', '产品市场群'), reason: 'agent_tool' })
    expect(res.ok).toBe(true)
    expect(clockRef).toBe(2)
    expect(inj.steps.filter((s) => s.op === 'focus')).toEqual([{ op: 'focus', arg: '产品市场群' }])
    expect(inj.steps.filter((s) => s.op === 'fill').map((s) => s.arg)).toEqual(['第一句', '第二句'])
    expect(inj.commits()).toBe(2)
  })

  it('presses Enter once more on a miss (never re-pastes) and succeeds if the message then lands', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    const inj = createFakeInjector({
      onCommit: (n) => {
        if (n === 2) db.addMine('wxid_alice', 'hello', 1_005_000)
      },
    })
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    const res = await sender.send(req('hello'))
    expect(res).toMatchObject({ ok: true, verified: true })
    expect(inj.steps.filter((s) => s.op === 'fill')).toHaveLength(1)
    expect(inj.commits()).toBe(2)
    expect(sender.halted).toBe(false)
  })

  it('does not repeat an uncertain AX send and still halts on missing DB confirmation', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    const inj = createFakeInjector()
    const { sender } = harness({ injector: { ...inj.injector, retryCommit: false }, substrate: db.substrate })
    const result = await sender.send(req('hello'))
    expect(result).toMatchObject({ ok: false, verified: false })
    expect(inj.commits()).toBe(1)
    expect(sender.halted).toBe(true)
  })

  it('preserves actionable AX capability errors', async () => {
    const db = createFakeSubstrate()
    const inj = createFakeInjector({ failFocus: new InjectorError('unsupported', '微信版本与控件配置不一致') })
    const { sender } = harness({ injector: { ...inj.injector, detailedErrors: true }, substrate: db.substrate })
    expect(await sender.send(req('hello'))).toMatchObject({ ok: false, error: '微信版本与控件配置不一致' })
    expect(inj.commits()).toBe(0)
  })

  it('halts with not-sent when nothing ever lands, clears the queue and needs resume()', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    const script: { onCommit?: (n: number) => void } = {}
    const inj = createFakeInjector(script)
    const { sender, events } = harness({ injector: inj.injector, substrate: db.substrate })

    const first = sender.send(req('a'))
    const second = sender.send(req('b', 'wxid_bob'))
    const r1 = await first
    const r2 = await second
    expect(r1).toEqual({ ok: false, verified: false, error: '没能确认消息已发出，已停止后续发送' })
    expect(r2).toMatchObject({ ok: false, verified: false, error: expect.stringContaining('已熔断') })
    expect(sender.halted).toBe(true)
    expect(sender.haltReason).toContain('没能确认')
    expect(inj.commits()).toBe(2) // one send + one retry; the queued job never touched the keyboard
    expect(events).toEqual([{ type: 'autoreply.halted', reason: '没能确认消息已发出，已停止后续发送' }])

    const r3 = await sender.send(req('c'))
    expect(r3.ok).toBe(false)
    expect(inj.commits()).toBe(2)

    sender.resume()
    expect(sender.halted).toBe(false)
    script.onCommit = () => db.addMine('wxid_alice', 'd', 2_000_000)
    const r4 = await sender.send(req('d'))
    expect(r4).toMatchObject({ ok: true, verified: true })
    expect(inj.commits()).toBe(3)
  })

  it('detects a wrong-session send by finding our text in another recently changed chat', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    db.addSession('wxid_carol', 'Carol')
    db.addSession('wxid_dave', 'Dave')
    const inj = createFakeInjector({
      onCommit: (n) => {
        if (n === 1) db.addMine('wxid_carol', '报价单在附件里', 1_000_050)
      },
    })
    const { sender, events } = harness({ injector: inj.injector, substrate: db.substrate })
    const res = await sender.send(req('报价单在附件里'))
    expect(res).toEqual({ ok: false, verified: false, error: '发到了「Carol」，已停止后续发送' })
    expect(sender.halted).toBe(true)
    expect(events[0]).toMatchObject({ type: 'autoreply.halted', reason: expect.stringContaining('Carol') })
  })

  it('does not blame another chat just because its timestamp moved', async () => {
    const db = createFakeSubstrate()
    db.addSession('wxid_alice', 'Alice')
    db.addSession('wxid_carol', 'Carol', 1_000_010) // someone else messaged us; not our text
    const inj = createFakeInjector()
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    const res = await sender.send(req('x'))
    expect(res.error).toBe('没能确认消息已发出，已停止后续发送')
  })

  it('maps injector failures to halt reasons without touching the DB', async () => {
    const db = createFakeSubstrate()
    const inj = createFakeInjector({ failFill: new InjectorError('no-permission') })
    const { sender, events } = harness({ injector: inj.injector, substrate: db.substrate })
    const res = await sender.send(req('x'))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('辅助功能权限')
    expect(inj.commits()).toBe(0)
    expect(events[0]).toMatchObject({ type: 'autoreply.halted' })

    sender.resume()
    const inj2 = createFakeInjector({ failFocus: new Error('osascript exploded') })
    const { sender: s2 } = harness({ injector: inj2.injector, substrate: db.substrate })
    const r2 = await s2.send(req('x'))
    expect(r2).toEqual({ ok: false, verified: false, error: 'osascript exploded' })
  })

  it('rejects non-text parts and empty text without halting', async () => {
    const db = createFakeSubstrate()
    const inj = createFakeInjector()
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    expect(await sender.send({ ...req('x'), parts: [{ type: 'image', path: '/tmp/a.png' }] })).toMatchObject({ ok: false, error: expect.stringContaining('只支持文本') })
    expect(await sender.send({ ...req('x'), parts: [{ type: 'text', text: '   ' }] })).toMatchObject({ ok: false })
    expect(sender.halted).toBe(false)
    expect(inj.steps).toEqual([])
  })

  it('exposes itself as a wechat-ui adapter whose state mirrors the halt latch', async () => {
    const db = createFakeSubstrate()
    const inj = createFakeInjector()
    const { sender } = harness({ injector: inj.injector, substrate: db.substrate })
    const adapter = sender.asAdapter()
    const states: string[] = []
    adapter.onStateChange((s) => states.push(s))
    expect(adapter.channel).toBe('wechat-ui')
    expect(adapter.state).toBe('connected')
    await adapter.send(req('x'))
    expect(adapter.state).toBe('error')
    sender.resume()
    expect(adapter.state).toBe('connected')
    expect(states).toEqual(['error', 'connected'])
  })
})
