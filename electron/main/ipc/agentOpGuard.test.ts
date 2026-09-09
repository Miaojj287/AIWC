import type { ThreadId, ThreadOrigin, ThreadSettings } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { guardRendererOp, type OpGuardResult } from './agentOpGuard'

const desktopThread = 'thr_desktop' as ThreadId
const botThread = 'thr_bot' as ThreadId
const cronThread = 'thr_cron' as ThreadId
const origins: Record<string, ThreadOrigin> = {
  [desktopThread]: { channel: 'desktop', chatId: 'me' },
  [botThread]: { channel: 'wechat-ilink', chatId: 'group_1', peerId: 'wxid_x' },
  [cronThread]: { channel: 'cron' },
}
const deps = { lookupOrigin: async (id: ThreadId) => origins[id] }
const settings: ThreadSettings = { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] }
const guard = (raw: unknown): Promise<OpGuardResult> => guardRendererOp(raw, deps)
const rejected = (r: OpGuardResult): string => (r.ok ? 'ok' : r.code)

describe('agent:submit renderer guard', () => {
  it('rejects malformed ops and unknown fields', async () => {
    expect(rejected(await guard(null))).toBe('invalid_op')
    expect(rejected(await guard({ type: 'turn.start', threadId: desktopThread }))).toBe('invalid_op')
    expect(rejected(await guard({ type: 'nope', threadId: desktopThread }))).toBe('invalid_op')
    expect(rejected(await guard({ type: 'thread.compact', threadId: desktopThread, extra: 1 }))).toBe('invalid_op')
    expect(rejected(await guard({ type: 'thread.rollback', threadId: desktopThread, turns: 0 }))).toBe('invalid_op')
    const r = await guard({ type: 'turn.start', threadId: desktopThread, input: { content: [], mentions: [] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.threadId).toBe(desktopThread)
  })

  it('thread.create is limited to the desktop channel and renderer profiles', async () => {
    const create = (origin: ThreadOrigin, profile: ThreadSettings['profile']) =>
      guard({ type: 'thread.create', threadId: 'thr_new', origin, settings: { ...settings, profile } })
    expect(rejected(await create({ channel: 'desktop' }, 'desktop-chat'))).toBe('ok')
    expect(rejected(await create({ channel: 'desktop', peerId: 'wxid_a' }, 'persona'))).toBe('ok')
    expect(rejected(await create({ channel: 'desktop' }, 'persona'))).toBe('ok')
    expect(rejected(await create({ channel: 'wechat-ilink', chatId: 'g' }, 'desktop-chat'))).toBe('forbidden_origin')
    expect(rejected(await create({ channel: 'cron' }, 'cron'))).toBe('forbidden_origin')
    expect(rejected(await create({ channel: 'desktop' }, 'wechat-bot'))).toBe('forbidden_profile')
    expect(rejected(await create({ channel: 'desktop' }, 'subagent'))).toBe('forbidden_profile')
  })

  it('ops on host-owned (bot / cron) threads are refused except interrupt and approval', async () => {
    const turn = { type: 'turn.start', input: { content: [{ type: 'text', text: 'hi' }], mentions: [] } }
    expect(rejected(await guard({ ...turn, threadId: desktopThread }))).toBe('ok')
    expect(rejected(await guard({ ...turn, threadId: botThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'thread.clear', threadId: cronThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'thread.shutdown', threadId: botThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'turn.interrupt', threadId: botThread }))).toBe('ok')
    expect(rejected(await guard({ type: 'approval.resolve', threadId: botThread, approvalId: 'apr_1', decision: 'deny' }))).toBe('ok')
    // unknown thread: passes through so the kernel reports the missing id itself
    expect(rejected(await guard({ type: 'thread.compact', threadId: 'thr_missing' }))).toBe('ok')
  })

  it('thread.settings may not change permissionMode on non-desktop threads nor pick a non-renderer profile', async () => {
    expect(rejected(await guard({ type: 'thread.settings', threadId: desktopThread, patch: { permissionMode: 'bypass' } }))).toBe('ok')
    const r = await guard({ type: 'thread.settings', threadId: botThread, patch: { permissionMode: 'ask' } })
    expect(rejected(r)).toBe('forbidden_thread')
    if (!r.ok) expect(r.message).toContain('权限模式')
    expect(rejected(await guard({ type: 'thread.settings', threadId: botThread, patch: { title: 'x' } }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'thread.settings', threadId: desktopThread, patch: { profile: 'wechat-bot' } }))).toBe('forbidden_profile')
    expect(rejected(await guard({ type: 'thread.settings', threadId: desktopThread, patch: { profile: 'persona', model: { providerId: 'p', modelId: 'm' } } }))).toBe('ok')
  })

  it('returns the parsed op unchanged on success', async () => {
    const op = { type: 'approval.resolve', threadId: desktopThread, approvalId: 'apr_9', decision: 'allow_once' }
    const r = await guard(op)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op).toEqual(op)
  })
})
