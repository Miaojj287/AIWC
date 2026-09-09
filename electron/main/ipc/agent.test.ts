import type { Op, ThreadId, ThreadOrigin } from '@aiwc/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { registerAgentIpc } from './agent'
import type { Handle, Handler, HostBridge } from './register'

const desktopThread = 'thr_desktop' as ThreadId
const botThread = 'thr_bot' as ThreadId
const origins: Record<string, ThreadOrigin> = {
  [desktopThread]: { channel: 'desktop', chatId: 'me' },
  [botThread]: { channel: 'wechat-ilink', chatId: 'g@chatroom', peerId: 'wxid_x' },
}

function setup() {
  const submit = vi.fn(async (_op: Op) => undefined)
  const warn = vi.fn()
  const broadcast = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), files: () => [], child: () => logger }
  const ctx = {
    kernel: {
      submit,
      getThread: async (id: ThreadId) => (origins[id] ? { record: { origin: origins[id] }, items: [] } : undefined),
    },
    logger,
    broadcast,
  } as unknown as AppContext
  const handlers = new Map<string, Handler<never>>()
  const handle: Handle = (channel, fn) => {
    handlers.set(channel, fn as Handler<never>)
  }
  registerAgentIpc(ctx, {} as HostBridge, handle)
  const submitHandler = handlers.get('agent:submit') as unknown as (raw: unknown) => Promise<void>
  return { submit, warn, broadcast, invoke: (raw: unknown) => submitHandler(raw) }
}

describe('agent:submit IPC handler', () => {
  it('forwards a valid renderer op to the kernel untouched', async () => {
    const { submit, invoke, broadcast } = setup()
    const op = { type: 'turn.start', threadId: desktopThread, input: { content: [{ type: 'text', text: 'hi' }], mentions: [] } }
    await invoke(op)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]?.[0]).toEqual(op)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('on violation: logs, broadcasts an error event to the thread and throws without reaching the kernel', async () => {
    const { submit, warn, broadcast, invoke } = setup()
    const op = { type: 'turn.start', threadId: botThread, input: { content: [{ type: 'text', text: 'hi' }], mentions: [] } }
    await expect(invoke(op)).rejects.toThrow(/wechat-ilink/)
    expect(submit).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('forbidden_thread')
    expect(broadcast).toHaveBeenCalledTimes(1)
    const [channel, event] = broadcast.mock.calls[0] as [string, { type: string; threadId: string; error: { code: string } }]
    expect(channel).toBe('agent:event')
    expect(event.type).toBe('error')
    expect(event.threadId).toBe(botThread)
    expect(event.error.code).toBe('forbidden_thread')
  })

  it('malformed payloads without a thread id are rejected and logged but produce no thread event', async () => {
    const { submit, warn, broadcast, invoke } = setup()
    await expect(invoke({ type: 'thread.create', origin: { channel: 'desktop' } })).rejects.toThrow()
    await expect(invoke('not an op')).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('approval.resolve carries the thread id through to the kernel op', async () => {
    const { submit, invoke } = setup()
    await invoke({ type: 'approval.resolve', threadId: botThread, approvalId: 'apr_1', decision: 'deny' })
    const forwarded = submit.mock.calls[0]?.[0]
    expect(forwarded?.type).toBe('approval.resolve')
    expect(forwarded?.threadId).toBe(botThread)
  })
})
