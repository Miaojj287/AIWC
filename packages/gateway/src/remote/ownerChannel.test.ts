import { describe, expect, it } from 'vitest'
import type { MobileSendRecord } from '@aiwc/protocol'
import { createGateway } from '../core/gateway'
import { withOriginGuard } from '../core/originGuard'
import { createFakeAdapter } from '../testing/fakeAdapter'
import { createOwnerChannel } from './ownerChannel'

function setup(owner: string | null = 'owner_1') {
  const gateway = createGateway({ rules: async () => [] })
  const ilink = createFakeAdapter('wechat-ilink')
  const ui = createFakeAdapter('wechat-ui')
  gateway.registerAdapter(ilink)
  gateway.registerAdapter(ui)
  const audit: MobileSendRecord[] = []
  const channel = createOwnerChannel({
    outbound: gateway.outbound,
    ownerId: () => owner ?? undefined,
    audit: (r) => audit.push(r),
    now: () => 42,
  })
  return { channel, ilink, ui, audit, gateway }
}

describe('owner channel', () => {
  it('sends to the owner on the iLink bot and audits without the text', async () => {
    const s = setup()
    const result = await s.channel.send('  任务完成  ', { kind: 'task', taskId: 't1' })
    expect(result.ok).toBe(true)
    expect(s.ilink.sent).toHaveLength(1)
    expect(s.ilink.sent[0]).toMatchObject({
      to: { channel: 'wechat-ilink', chatId: 'owner_1', peerId: 'owner_1', chatType: 'dm' },
      parts: [{ type: 'text', text: '任务完成' }],
      reason: 'cron',
    })
    expect(s.ui.sent).toEqual([])
    expect(s.audit).toEqual([{ at: 42, kind: 'task', ok: true, chars: 4, taskId: 't1' }])
    expect(JSON.stringify(s.audit)).not.toContain('任务')
  })

  it('refuses and audits when no owner is bound', async () => {
    const s = setup(null)
    const result = await s.channel.send('hi', { kind: 'reply' })
    expect(result).toEqual({ ok: false, error: 'no_owner' })
    expect(s.ilink.sent).toEqual([])
    expect(s.audit).toEqual([{ at: 42, kind: 'reply', ok: false, error: 'no_owner', chars: 2 }])
  })

  it('refuses empty text', async () => {
    const s = setup()
    expect(await s.channel.send('   ', { kind: 'notice' })).toEqual({ ok: false, error: 'empty' })
    expect(s.ilink.sent).toEqual([])
  })

  it('records channel failures', async () => {
    const s = setup()
    s.ilink.sendImpl = async () => ({ ok: false, error: 'offline' })
    await s.channel.send('hi', { kind: 'notice' })
    expect(s.audit[0]).toMatchObject({ ok: false, error: 'offline' })
  })
})

describe('origin guard for wechat-remote', () => {
  it('rewrites any target to the owner chat on wechat-ilink', async () => {
    const s = setup()
    const guarded = withOriginGuard(s.gateway.outbound, {
      channel: 'wechat-remote',
      chatId: 'owner_1',
      peerId: 'owner_1',
    })
    await guarded.send({
      to: { channel: 'wechat-ui', chatId: 'boss', peerId: 'boss', chatType: 'dm' },
      parts: [{ type: 'text', text: 'leak?' }],
      reason: 'agent_tool',
    })
    expect(s.ui.sent).toEqual([])
    expect(s.ilink.sent[0]?.to).toMatchObject({ channel: 'wechat-ilink', chatId: 'owner_1' })
  })

  it('refuses when the origin has no chat', async () => {
    const s = setup()
    const guarded = withOriginGuard(s.gateway.outbound, { channel: 'wechat-remote' })
    const result = await guarded.send({
      to: { channel: 'wechat-ilink', chatId: 'x', peerId: 'x', chatType: 'dm' },
      parts: [{ type: 'text', text: 'x' }],
      reason: 'agent_tool',
    })
    expect(result.ok).toBe(false)
    expect(s.ilink.sent).toEqual([])
  })
})
