import type { HistoryItem, ThreadId, ThreadOrigin } from '@aiwc/protocol'
import type { ThreadRecord } from '@aiwc/kernel'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { registerConversationIpc } from './conversation'
import type { HostBridge } from './register'
import { createHandlerHarness } from './testing/handlerHarness'

const record = (threadId: string, origin: ThreadOrigin, extra: Partial<ThreadRecord> = {}): ThreadRecord => ({
  threadId: threadId as ThreadId,
  origin,
  settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
  title: threadId,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
  archived: false,
  itemCount: 1,
  ...extra,
})

const records: Record<string, ThreadRecord> = {
  thr_desk: record('thr_desk', {
    channel: 'desktop',
    contextRef: { kind: 'file', id: '/notes/a.md', label: 'a.md' },
  }),
  thr_bot: record('thr_bot', { channel: 'wechat-ilink', chatId: 'g@chatroom' }),
  thr_fork: record('thr_fork', { channel: 'desktop' }, { title: '分支' }),
}

function setup(forkError?: unknown) {
  const updateMeta = vi.fn(async () => undefined)
  const listThreads = vi.fn(async () => [{ ...records.thr_desk!, archived: true }])
  const forkThread = vi.fn(async () => {
    if (forkError) throw forkError
    return 'thr_fork' as ThreadId
  })
  const ctx = {
    kernel: {
      updateMeta,
      listThreads,
      forkThread,
      getThread: async (id: ThreadId) =>
        records[id] ? { record: records[id], items: [] as HistoryItem[], running: false } : undefined,
    },
  } as unknown as AppContext
  const ipc = createHandlerHarness()
  registerConversationIpc(ctx, {} as HostBridge, ipc.handle)
  return { ipc, updateMeta, listThreads, forkThread }
}

describe('conversation IPC', () => {
  it('archives desktop threads only, and validates the request', async () => {
    const { ipc, updateMeta } = setup()
    await ipc.invoke('agent:archiveThread', { threadId: 'thr_desk' as ThreadId, archived: true })
    expect(updateMeta).toHaveBeenCalledWith('thr_desk', { archived: true })
    await expect(
      ipc.invoke('agent:archiveThread', { threadId: 'thr_bot' as ThreadId, archived: true }),
    ).rejects.toThrow()
    await expect(
      Promise.resolve(ipc.invokeRaw('agent:archiveThread', { threadId: 'thr_desk', archived: 'yes' })),
    ).rejects.toThrow()
    await expect(
      ipc.invoke('agent:archiveThread', { threadId: 'thr_nope' as ThreadId, archived: true }),
    ).rejects.toThrow()
    expect(updateMeta).toHaveBeenCalledTimes(1)
  })

  it('lists archived desktop threads with their stored context chip', async () => {
    const { ipc, listThreads } = setup()
    const list = await ipc.invoke('agent:listArchivedThreads', { limit: 5_000 })
    expect(listThreads).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'desktop', archivedOnly: true, limit: 200, offset: 0 }),
    )
    expect(list[0]).toMatchObject({
      threadId: 'thr_desk',
      archived: true,
      contextRef: { kind: 'file', id: '/notes/a.md', label: 'a.md' },
    })
  })

  it('forks a desktop thread and words the kernel refusals', async () => {
    const { ipc, forkThread } = setup()
    const forked = await ipc.invoke('agent:forkThread', {
      threadId: 'thr_desk' as ThreadId,
      throughItemId: 'itm_1' as never,
      title: '  分支 ',
    })
    expect(forkThread).toHaveBeenCalledWith('thr_desk', { throughItemId: 'itm_1', title: '分支' })
    expect(forked).toMatchObject({ threadId: 'thr_fork', title: '分支' })
    await expect(
      ipc.invoke('agent:forkThread', { threadId: 'thr_bot' as ThreadId, throughItemId: 'itm_1' as never, title: 'x' }),
    ).rejects.toThrow()

    const refused = setup(Object.assign(new Error('raw'), { code: 'fork_turn_running' }))
    const error = await Promise.resolve(
      refused.ipc.invoke('agent:forkThread', {
        threadId: 'thr_desk' as ThreadId,
        throughItemId: 'itm_1' as never,
        title: 'x',
      }),
    ).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toBe('raw')
  })
})
