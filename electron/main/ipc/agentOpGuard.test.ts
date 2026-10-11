import { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, type ThreadId, type ThreadOrigin, type ThreadSettings } from '@aiwc/protocol'
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
    // `/compact 保留…`: a bounded focus note is accepted, an oversized one is not
    expect(rejected(await guard({ type: 'thread.compact', threadId: desktopThread, instructions: '保留报价' }))).toBe(
      'ok',
    )
    expect(
      rejected(await guard({ type: 'thread.compact', threadId: desktopThread, instructions: 'x'.repeat(5000) })),
    ).toBe('invalid_op')
    expect(rejected(await guard({ type: 'thread.rollback', threadId: desktopThread, turns: 0 }))).toBe('invalid_op')
    const r = await guard({ type: 'turn.start', threadId: desktopThread, input: { content: [], mentions: [] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.threadId).toBe(desktopThread)
  })

  it('enforces attachment limits and accepts a per-thread reasoning effort', async () => {
    const send = (content: unknown[]) =>
      guard({ type: 'turn.start', threadId: desktopThread, input: { content, mentions: [] } })
    const png = { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'a.png' }
    expect(rejected(await send([{ type: 'text', text: 'hi' }, png]))).toBe('ok')
    expect(rejected(await send(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => png)))).toBe('invalid_op')
    expect(rejected(await send([{ ...png, data: 'A'.repeat(MAX_IMAGE_BYTES * 2) }]))).toBe('invalid_op')
    expect(rejected(await send([{ ...png, data: 'not base64!' }]))).toBe('invalid_op')
    const patch = (reasoningEffort: string) =>
      guard({ type: 'thread.settings', threadId: desktopThread, patch: { reasoningEffort } })
    expect(rejected(await patch('low'))).toBe('ok')
    expect(rejected(await patch('turbo'))).toBe('invalid_op')
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
    expect(rejected(await guard({ ...turn, threadId: desktopThread, clientInputId: 'cin_1' }))).toBe('ok')
    expect(rejected(await guard({ ...turn, threadId: desktopThread, clientInputId: 'x'.repeat(65) }))).toBe(
      'invalid_op',
    )
    expect(rejected(await guard({ ...turn, threadId: botThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'thread.clear', threadId: cronThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'thread.shutdown', threadId: botThread }))).toBe('forbidden_thread')
    expect(rejected(await guard({ type: 'turn.interrupt', threadId: botThread }))).toBe('ok')
    expect(
      rejected(await guard({ type: 'approval.resolve', threadId: botThread, approvalId: 'apr_1', decision: 'deny' })),
    ).toBe('ok')
    // unknown thread: passes through so the kernel reports the missing id itself
    expect(rejected(await guard({ type: 'thread.compact', threadId: 'thr_missing' }))).toBe('ok')
  })

  it('thread.settings may not change permissionMode on non-desktop threads nor pick a non-renderer profile', async () => {
    expect(
      rejected(await guard({ type: 'thread.settings', threadId: desktopThread, patch: { permissionMode: 'bypass' } })),
    ).toBe('ok')
    const r = await guard({ type: 'thread.settings', threadId: botThread, patch: { permissionMode: 'ask' } })
    expect(rejected(r)).toBe('forbidden_thread')
    if (!r.ok) expect(r.message).toContain('权限模式')
    expect(rejected(await guard({ type: 'thread.settings', threadId: botThread, patch: { title: 'x' } }))).toBe(
      'forbidden_thread',
    )
    expect(
      rejected(await guard({ type: 'thread.settings', threadId: desktopThread, patch: { profile: 'wechat-bot' } })),
    ).toBe('forbidden_profile')
    expect(
      rejected(
        await guard({
          type: 'thread.settings',
          threadId: desktopThread,
          patch: { profile: 'persona', model: { providerId: 'p', modelId: 'm' } },
        }),
      ),
    ).toBe('ok')
  })

  it('returns the parsed op unchanged on success', async () => {
    const op = { type: 'approval.resolve', threadId: desktopThread, approvalId: 'apr_9', decision: 'allow_once' }
    const r = await guard(op)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op).toEqual(op)
  })

  it('approval.resolve accepts a bounded denial note and a known grant scope only', async () => {
    const base = { type: 'approval.resolve', threadId: desktopThread, approvalId: 'apr_9' }
    expect(rejected(await guard({ ...base, decision: 'deny', reason: '换个文件名' }))).toBe('ok')
    expect(rejected(await guard({ ...base, decision: 'allow_always', scope: 'global' }))).toBe('ok')
    expect(rejected(await guard({ ...base, decision: 'allow_always', scope: 'everyone' }))).toBe('invalid_op')
    expect(rejected(await guard({ ...base, decision: 'deny', reason: 'x'.repeat(1001) }))).toBe('invalid_op')
  })
})

describe('agent:submit guard — rewind and context chip', () => {
  it('accepts a rollback to an item and a desktop thread created with its context chip', async () => {
    const rollback = { type: 'thread.rollback', threadId: desktopThread, turns: 2, fromItemId: 'itm_1' }
    expect(rejected(await guard(rollback))).toBe('ok')
    expect(rejected(await guard({ ...rollback, fromItemId: '' }))).toBe('invalid_op')
    const create = (contextRef: unknown) =>
      guard({ type: 'thread.create', threadId: 'thr_new', origin: { channel: 'desktop', contextRef }, settings })
    expect(rejected(await create({ kind: 'session', id: 'wxid_x', label: '项目群' }))).toBe('ok')
    expect(rejected(await create({ kind: 'memory', id: 'x', label: 'x' }))).toBe('invalid_op')
    expect(rejected(await create({ kind: 'file', id: '/a.md', label: 'a.md', extra: 1 }))).toBe('invalid_op')
  })
})
