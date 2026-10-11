import { describe, expect, it, vi } from 'vitest'
import type { Event, TaskRun, ThreadId, ThreadOrigin } from '@aiwc/protocol'
import { createAttentionNotices } from './composeNotifications'
import type { AttentionNotice } from './services/systemNotifier'

function setup(opts: { showNames?: boolean; origins?: Record<string, ThreadOrigin> } = {}) {
  const listeners = new Set<(e: Event) => void>()
  const notices: AttentionNotice[] = []
  const origins = opts.origins ?? { thr_desk: { channel: 'desktop' }, thr_cron: { channel: 'cron' } }
  const kernel = {
    events: {
      on: (l: (e: Event) => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    },
    getThread: vi.fn(async (threadId: ThreadId) => {
      const origin = origins[threadId]
      if (!origin) return undefined
      const settings = { permissionMode: 'ask' as const, profile: 'desktop-chat' as const, allowAlways: [] }
      const record = {
        threadId,
        origin,
        settings,
        title: '',
        createdAt: 0,
        updatedAt: 0,
        pinned: false,
        archived: false,
        itemCount: 0,
      }
      return { record, items: [], running: true }
    }),
  }
  const n = createAttentionNotices({
    attention: (notice) => notices.push(notice),
    showNames: () => opts.showNames ?? false,
    kernel,
  })
  const emit = (e: Event) => listeners.forEach((l) => l(e))
  return { n, notices, emit, listeners }
}

const approval = (threadId: string): Event => ({
  type: 'approval.requested',
  threadId: threadId as ThreadId,
  turnId: 'trn_1' as never,
  approvalId: 'apr_1' as never,
  callId: 'cal_1' as never,
  toolName: 'send_message',
  summary: '发送消息到 张三：明天改到下午',
  input: {},
  risk: 'send',
  canAllowAlways: false,
})

describe('createAttentionNotices', () => {
  it('raises a notice for an approval on a desktop thread that opens that thread', async () => {
    const { notices, emit } = setup()
    emit(approval('thr_desk'))
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(notices[0]).toMatchObject({
      key: 'approval:apr_1',
      title: 'Agent 需要你确认',
      body: '有一个操作在等你确认',
      action: { command: 'agent.openThread', payload: { threadId: 'thr_desk' } },
    })
  })

  it('ignores approvals of threads nobody sits in front of', async () => {
    const { notices, emit } = setup()
    emit(approval('thr_cron'))
    emit(approval('thr_unknown'))
    await new Promise((r) => setTimeout(r, 0))
    expect(notices).toEqual([])
  })

  it('keeps names and message text out of the body unless the user allowed them', async () => {
    const hidden = setup()
    hidden.n.replyDraft({ sessionId: 'g1', name: '张三' })
    hidden.emit(approval('thr_desk'))
    await vi.waitFor(() => expect(hidden.notices).toHaveLength(2))
    expect(JSON.stringify(hidden.notices.map((x) => [x.title, x.body]))).not.toMatch(/张三|明天/)

    const shown = setup({ showNames: true })
    shown.n.replyDraft({ sessionId: 'g1', name: '张三' })
    shown.emit(approval('thr_desk'))
    await vi.waitFor(() => expect(shown.notices).toHaveLength(2))
    expect(shown.notices[0]?.body).toContain('张三')
    expect(shown.notices[1]?.body).toContain('明天改到下午')
  })

  it('reports finished task runs with what to open, and nothing for running or skipped ones', () => {
    const { n, notices } = setup()
    const run = (patch: Partial<TaskRun>): TaskRun => ({
      id: 'run_1',
      taskId: 'task_1',
      trigger: 'schedule',
      status: 'done',
      startedAt: 1,
      denied: [],
      toolCalls: 2,
      ...patch,
    })
    n.taskRun(run({ status: 'running' }), '晨报')
    n.taskRun(run({ status: 'skipped' }), '晨报')
    n.taskRun(run({}), '晨报')
    n.taskRun(run({ id: 'run_2', status: 'failed' }), '晨报')
    expect(notices.map((x) => x.title)).toEqual(['定时任务完成：晨报', '定时任务失败：晨报'])
    expect(notices[0]?.action).toEqual({ command: 'tab.openTask', payload: { id: 'task_1' } })
  })

  it('does not listen to the kernel without a notifier', () => {
    const listeners = new Set<unknown>()
    createAttentionNotices({
      showNames: () => false,
      kernel: { events: { on: (l) => (listeners.add(l), () => listeners.delete(l)) }, getThread: vi.fn() },
    })
    expect(listeners.size).toBe(0)
  })
})
