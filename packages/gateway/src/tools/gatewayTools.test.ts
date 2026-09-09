import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelKind, SendRequest, SendResult, ToolContext } from '@aiwc/protocol'
import { asCallId, asThreadId, asTurnId, newStepId } from '@aiwc/protocol'
import { MEDIA_ROOTS_MISSING_ERROR } from '../core/mediaPolicy'
import { gatewayTools, isBotContext, resolveTarget, type GatewayToolServices } from './gatewayTools'

function fakeOutbound() {
  const sent: SendRequest[] = []
  return {
    sent,
    outbound: {
      send: vi.fn(async (req: SendRequest): Promise<SendResult> => {
        sent.push(req)
        return { ok: true, messageId: `m${sent.length}` }
      }),
    },
  }
}

function ctx(channel: ChannelKind, origin?: { channel: ChannelKind; chatId: string }, services: GatewayToolServices = {}): ToolContext<GatewayToolServices> {
  return {
    threadId: asThreadId('thr_1'),
    turnId: asTurnId('trn_1'),
    stepId: newStepId(),
    callId: asCallId('cal_1'),
    channel,
    profile: channel === 'desktop' ? 'desktop-chat' : 'wechat-bot',
    origin,
    signal: new AbortController().signal,
    services,
    progress: () => {},
    depth: 0,
  }
}

const byName = (name: string) => {
  const tool = gatewayTools(fakeOutbound().outbound).find((t) => t.name === name)
  if (!tool) throw new Error(name)
  return tool
}

describe('gatewayTools', () => {
  it('exposes send_message / send_media (send risk) and draft_reply (read) with the right profiles', () => {
    const tools = gatewayTools(fakeOutbound().outbound)
    expect(tools.map((t) => t.name)).toEqual(['send_message', 'send_media', 'draft_reply'])
    expect(byName('send_message')).toMatchObject({ risk: 'send', parallelSafe: false, profiles: ['desktop-chat', 'wechat-bot'] })
    expect(byName('send_media')).toMatchObject({ risk: 'send', profiles: ['desktop-chat'] })
    // A bot thread runs on a remote contact's text: a read-any-file-and-upload tool there is exfiltration.
    expect(byName('send_media').profiles).not.toContain('wechat-bot')
    expect(byName('draft_reply')).toMatchObject({ risk: 'read', parallelSafe: true, profiles: ['wechat-bot', 'cron'] })
    expect(byName('send_message').summarize?.({ text: '你好世界', to: 'u1' })).toBe('发送消息到 u1：你好世界')
    expect(byName('send_message').inputSchema.safeParse({ text: '' }).success).toBe(false)
    expect(byName('send_media').inputSchema.safeParse({ path: '/a.png', kind: 'gif' }).success).toBe(false)
  })

  it('on a wechat channel, ignores `to` and sends to the origin chat', async () => {
    const fake = fakeOutbound()
    const [sendMessage] = gatewayTools(fake.outbound)
    const res = await sendMessage!.execute({ text: '秘密', to: 'u_victim' }, ctx('wechat-ilink', { channel: 'wechat-ilink', chatId: 'u_owner' }))
    expect(res.isError).toBeFalsy()
    expect(res.content).toMatchObject({ ok: true, to: 'u_owner', channel: 'wechat-ilink', messageId: 'm1' })
    expect(fake.sent[0]?.to).toEqual({ channel: 'wechat-ilink', chatId: 'u_owner', peerId: 'u_owner', chatType: 'dm' })
    expect(fake.sent[0]?.reason).toBe('agent_tool')
  })

  it('uses the origin even when the current channel is desktop but the thread came from wechat', async () => {
    const fake = fakeOutbound()
    const [sendMessage] = gatewayTools(fake.outbound)
    await sendMessage!.execute({ text: 'x', to: 'other' }, ctx('desktop', { channel: 'wechat-ilink', chatId: 'g1@chatroom' }))
    expect(fake.sent[0]?.to).toMatchObject({ channel: 'wechat-ilink', chatId: 'g1@chatroom', chatType: 'group' })
  })

  it("treats the 'observed' channel as a bot context: `to` is ignored and the reply goes to the origin chat via the UI channel", async () => {
    const fake = fakeOutbound()
    const [sendMessage] = gatewayTools(fake.outbound)
    const res = await sendMessage!.execute({ text: '秘密', to: 'u_victim' }, ctx('observed', { channel: 'observed', chatId: 'wxid_owner' }))
    expect(res.isError).toBeFalsy()
    expect(fake.sent[0]?.to).toEqual({ channel: 'wechat-ui', chatId: 'wxid_owner', peerId: 'wxid_owner', chatType: 'dm' })
    // a desktop-profile turn on a thread that came from an observed chat is still bound to that chat
    expect(resolveTarget({ channel: 'desktop', origin: { channel: 'observed', chatId: 'g1@chatroom' } }, 'other', 'wechat-ilink')).toEqual({
      ok: true,
      to: { channel: 'wechat-ui', chatId: 'g1@chatroom', peerId: 'g1@chatroom', chatType: 'group' },
    })
    // an observed turn without a known origin chat refuses instead of falling back to `to`
    expect(resolveTarget({ channel: 'observed' }, 'u_victim', 'wechat-ui')).toEqual({ ok: false, error: expect.stringContaining('来源会话未知') })
    expect(isBotContext({ channel: 'observed' })).toBe(true)
    expect(isBotContext({ channel: 'desktop', origin: { channel: 'observed', chatId: 'x' } })).toBe(true)
  })

  it('refuses to send from a wechat thread whose origin chat is unknown', async () => {
    const fake = fakeOutbound()
    const [sendMessage] = gatewayTools(fake.outbound)
    const res = await sendMessage!.execute({ text: 'x', to: 'u1' }, ctx('wechat-ilink'))
    expect(res.isError).toBe(true)
    expect(res.content).toMatchObject({ ok: false, error: expect.stringContaining('来源会话未知') })
    expect(fake.outbound.send).not.toHaveBeenCalled()
  })

  it('desktop threads must name a target and send through the UI-injection channel', async () => {
    const fake = fakeOutbound()
    const [sendMessage] = gatewayTools(fake.outbound)
    const missing = await sendMessage!.execute({ text: 'x' }, ctx('desktop', { channel: 'desktop', chatId: 'me' }))
    expect(missing.isError).toBe(true)
    const ok = await sendMessage!.execute({ text: 'x', to: 'wxid_bob' }, ctx('desktop', { channel: 'desktop', chatId: 'me' }))
    expect(ok.isError).toBeFalsy()
    expect(fake.sent[0]?.to).toEqual({ channel: 'wechat-ui', chatId: 'wxid_bob', peerId: 'wxid_bob', chatType: 'dm' })
    expect(resolveTarget({ channel: 'desktop' }, 'g@chatroom', 'wechat-ilink')).toEqual({ ok: true, to: { channel: 'wechat-ilink', chatId: 'g@chatroom', peerId: 'g@chatroom', chatType: 'group' } })
  })

  it('prefers ctx.services.gateway over the closure outbound', async () => {
    const closure = fakeOutbound()
    const injected = fakeOutbound()
    const [sendMessage] = gatewayTools(closure.outbound)
    await sendMessage!.execute({ text: 'x' }, ctx('wechat-ilink', { channel: 'wechat-ilink', chatId: 'u1' }, { gateway: injected.outbound }))
    expect(injected.sent).toHaveLength(1)
    expect(closure.sent).toHaveLength(0)
  })

  it('reports send failures as tool errors', async () => {
    const fake = fakeOutbound()
    fake.outbound.send.mockResolvedValueOnce({ ok: false, error: '未登录' })
    const [sendMessage] = gatewayTools(fake.outbound)
    const res = await sendMessage!.execute({ text: 'x' }, ctx('wechat-ilink', { channel: 'wechat-ilink', chatId: 'u1' }))
    expect(res.isError).toBe(true)
    expect(res.content).toMatchObject({ ok: false, error: '未登录' })
  })

  it('send_media (desktop, no roots configured) builds the media part (+ caption) and requires `to`', async () => {
    const fake = fakeOutbound()
    const sendMedia = gatewayTools(fake.outbound)[1]!
    const desktop = ctx('desktop', { channel: 'desktop', chatId: 'me' })
    await sendMedia.execute({ path: '/tmp/a.png', kind: 'image', caption: '看这个', to: 'wxid_bob' }, desktop)
    expect(fake.sent[0]?.to).toMatchObject({ channel: 'wechat-ui', chatId: 'wxid_bob' })
    expect(fake.sent[0]?.parts).toEqual([
      { type: 'image', path: '/tmp/a.png' },
      { type: 'text', text: '看这个' },
    ])
    await sendMedia.execute({ path: '/tmp/a.silk', kind: 'voice' }, desktop)
    expect(fake.sent).toHaveLength(1) // desktop without `to` → error, nothing sent
    await sendMedia.execute({ path: '/tmp/a.pdf', kind: 'file', to: 'wxid_bob' }, desktop)
    expect(fake.sent[1]?.parts).toEqual([{ type: 'file', path: '/tmp/a.pdf' }])
  })

  it('draft_reply hands the text to the reply desk and never sends', async () => {
    const fake = fakeOutbound()
    const onDraft = vi.fn()
    const draftReply = gatewayTools(fake.outbound, { onDraft })[2]!
    const res = await draftReply.execute({ text: '这是草稿' }, ctx('wechat-ilink', { channel: 'wechat-ilink', chatId: 'u1' }))
    expect(res.isError).toBeFalsy()
    expect(res.content).toEqual({ drafted: true, text: '这是草稿', to: 'u1' })
    expect(onDraft).toHaveBeenCalledWith({ text: '这是草稿', origin: { channel: 'wechat-ilink', chatId: 'u1' }, threadId: 'thr_1' })
    expect(fake.outbound.send).not.toHaveBeenCalled()
  })

  describe('send_media path policy', () => {
    let root: string
    let outside: string
    let inside: string
    beforeEach(() => {
      const base = mkdtempSync(join(tmpdir(), 'aiwc-media-'))
      root = join(base, 'allowed')
      outside = join(base, 'outside')
      mkdirSync(root)
      mkdirSync(outside)
      inside = join(root, 'report.pdf')
      writeFileSync(inside, 'pdf')
      writeFileSync(join(outside, 'id_rsa'), 'secret')
    })
    afterEach(() => {
      rmSync(join(root, '..'), { recursive: true, force: true })
    })

    const botOrigin = { channel: 'wechat-ilink' as const, chatId: 'u_attacker' }
    const bot = (services: GatewayToolServices = {}) => ctx('wechat-ilink', botOrigin, services)
    const sendMediaWith = (fake: ReturnType<typeof fakeOutbound>, roots?: readonly string[] | (() => readonly string[])) => gatewayTools(fake.outbound, roots ? { mediaRoots: roots } : {})[1]!

    it('isBotContext is true when either the channel or the origin is a wechat channel', () => {
      expect(isBotContext({ channel: 'wechat-ilink' })).toBe(true)
      expect(isBotContext({ channel: 'desktop', origin: { channel: 'wechat-ui', chatId: 'x' } })).toBe(true)
      expect(isBotContext({ channel: 'desktop', origin: { channel: 'desktop', chatId: 'me' } })).toBe(false)
      expect(isBotContext({ channel: 'cron' })).toBe(false)
    })

    it('a bot thread with no media roots configured is refused outright (fail closed) and nothing is sent', async () => {
      const fake = fakeOutbound()
      const res = await sendMediaWith(fake).execute({ path: inside, kind: 'file' }, bot())
      expect(res.isError).toBe(true)
      expect(res.content).toMatchObject({ ok: false, error: MEDIA_ROOTS_MISSING_ERROR })
      expect(fake.outbound.send).not.toHaveBeenCalled()
    })

    it('a bot thread cannot send a file outside the roots — the classic ~/.ssh/id_rsa ask', async () => {
      const fake = fakeOutbound()
      const res = await sendMediaWith(fake, [root]).execute({ path: join(outside, 'id_rsa'), kind: 'file' }, bot())
      expect(res.isError).toBe(true)
      expect(res.content).toMatchObject({ ok: false, error: expect.stringContaining('不在允许发送的目录内') })
      expect((res.content as { error: string }).error).not.toContain(outside) // never echo the full path back to the bot
      expect(fake.outbound.send).not.toHaveBeenCalled()
    })

    it('a bot thread may send a file inside the roots; the canonical path is what goes out, to the origin only', async () => {
      const fake = fakeOutbound()
      const res = await sendMediaWith(fake, [root]).execute({ path: inside, kind: 'file', to: 'u_victim' }, bot())
      expect(res.isError).toBeFalsy()
      expect(fake.sent[0]?.to.chatId).toBe('u_attacker')
      expect(fake.sent[0]?.parts).toEqual([{ type: 'file', path: realpathSync(inside) }])
    })

    it('rejects `..` traversal, relative paths and symlinks that escape the root', async () => {
      const fake = fakeOutbound()
      const tool = sendMediaWith(fake, [root])
      const traversal = await tool.execute({ path: join(root, '..', 'outside', 'id_rsa'), kind: 'file' }, bot())
      expect(traversal.isError).toBe(true)
      const relative = await tool.execute({ path: 'report.pdf', kind: 'file' }, bot())
      expect(relative).toMatchObject({ isError: true, content: { error: expect.stringContaining('绝对路径') } })
      symlinkSync(join(outside, 'id_rsa'), join(root, 'innocent.txt'))
      const viaLink = await tool.execute({ path: join(root, 'innocent.txt'), kind: 'file' }, bot())
      expect(viaLink.isError).toBe(true)
      expect(fake.outbound.send).not.toHaveBeenCalled()
    })

    it('ctx.services.mediaRoots (composition root) wins over the construction-time fallback and may be a getter', async () => {
      const fake = fakeOutbound()
      const tool = sendMediaWith(fake, [outside])
      const res = await tool.execute({ path: inside, kind: 'image' }, bot({ mediaRoots: () => [root] }))
      expect(res.isError).toBeFalsy()
      expect(fake.sent).toHaveLength(1)
      const denied = await tool.execute({ path: join(outside, 'id_rsa'), kind: 'image' }, bot({ mediaRoots: () => [root] }))
      expect(denied.isError).toBe(true)
    })

    it('desktop threads are held to the roots too once they are configured', async () => {
      const fake = fakeOutbound()
      const desktop = ctx('desktop', { channel: 'desktop', chatId: 'me' }, { mediaRoots: [root] })
      const denied = await sendMediaWith(fake).execute({ path: join(outside, 'id_rsa'), kind: 'file', to: 'wxid_bob' }, desktop)
      expect(denied.isError).toBe(true)
      const ok = await sendMediaWith(fake).execute({ path: inside, kind: 'file', to: 'wxid_bob' }, desktop)
      expect(ok.isError).toBeFalsy()
      expect(fake.sent).toHaveLength(1)
    })

    it('a desktop-profile thread whose origin is a wechat chat is still a bot context', async () => {
      const fake = fakeOutbound()
      const res = await sendMediaWith(fake).execute({ path: inside, kind: 'file' }, ctx('desktop', { channel: 'wechat-ui', chatId: 'wxid_x' }))
      expect(res).toMatchObject({ isError: true, content: { error: MEDIA_ROOTS_MISSING_ERROR } })
      expect(fake.outbound.send).not.toHaveBeenCalled()
    })
  })
})
