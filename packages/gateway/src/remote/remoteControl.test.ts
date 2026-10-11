import { describe, expect, it, vi } from 'vitest'
import {
  asThreadId,
  type ApprovalId,
  type Event,
  type MobileRemoteSettings,
  type MobileSendRecord,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type TurnId,
  type CallId,
} from '@aiwc/protocol'
import { createGateway } from '../core/gateway'
import { createFakeAdapter, fakeEvent } from '../testing/fakeAdapter'
import { createOwnerChannel } from './ownerChannel'
import { createRemoteControl, type RemoteKernel, type RemoteNotice } from './remoteControl'

const OWNER = 'owner_user_1'
const TURN = 'trn_1' as TurnId

/** Kernel double: records ops, keeps thread settings, and lets the test emit events. */
function fakeKernel() {
  const listeners = new Set<(e: Event) => void>()
  const ops: Op[] = []
  const threads = new Map<ThreadId, { origin: ThreadOrigin; settings: ThreadSettings }>()
  const kernel: RemoteKernel & { ops: Op[]; emit(e: Event): void; threads: typeof threads } = {
    ops,
    threads,
    async submit(op) {
      ops.push(op)
      if (op.type === 'thread.create') threads.set(op.threadId, { origin: op.origin, settings: op.settings })
      if (op.type === 'thread.settings') {
        const t = threads.get(op.threadId)
        if (t) t.settings = { ...t.settings, ...op.patch }
      }
    },
    events: {
      on(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    async getThread(threadId) {
      const t = threads.get(threadId)
      return t ? { running: false, record: { origin: t.origin, settings: t.settings } } : undefined
    },
    emit(e) {
      for (const l of [...listeners]) l(e)
    },
  }
  return kernel
}

function setup(opts: { settings?: Partial<MobileRemoteSettings>; owner?: string | undefined; threadId?: string } = {}) {
  const gateway = createGateway({ rules: async () => [] })
  const ilink = createFakeAdapter('wechat-ilink')
  gateway.registerAdapter(ilink)
  const kernel = fakeKernel()
  const audit: MobileSendRecord[] = []
  const settings: MobileRemoteSettings = { enabled: true, permissionMode: 'ask', ...opts.settings }
  let owner = 'owner' in opts ? opts.owner : OWNER
  let saved: ThreadId | undefined = opts.threadId ? asThreadId(opts.threadId) : undefined
  let seq = 0
  const logger = vi.fn()
  const remote = createRemoteControl({
    kernel,
    channel: createOwnerChannel({ outbound: gateway.outbound, ownerId: () => owner, audit: (r) => audit.push(r) }),
    ownerId: () => owner,
    settings: () => settings,
    threadTitle: () => 'phone',
    loadThreadId: () => saved,
    saveThreadId: (id) => {
      saved = id
    },
    format: (notice) => JSON.stringify(notice),
    newThreadId: () => asThreadId(`thr_${++seq}`),
    now: () => 1_000,
    logger,
  })
  const notices = (): RemoteNotice[] =>
    ilink.sent.map((req) => {
      const part = req.parts[0]
      return JSON.parse(part?.type === 'text' ? part.text : '{}') as RemoteNotice
    })
  const fromOwner = (text: string) => fakeEvent({ text, source: { peerId: OWNER, chatId: OWNER, chatType: 'dm' } })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const setOwner = (next: string) => {
    owner = next
  }
  return { remote, kernel, ilink, audit, settings, notices, fromOwner, flush, logger, saved: () => saved, setOwner }
}

const approvalEvent = (
  threadId: ThreadId,
  id: string,
  over: Partial<Extract<Event, { type: 'approval.requested' }>> = {},
): Event => ({
  type: 'approval.requested',
  threadId,
  turnId: TURN,
  approvalId: id as ApprovalId,
  callId: `cal_${id}` as CallId,
  toolName: 'shell',
  summary: `run ${id}`,
  input: {},
  risk: 'write',
  canAllowAlways: true,
  ...over,
})

describe('remote control · owner gate', () => {
  it('ignores and logs anyone but the owner, without replying or starting a turn', async () => {
    const s = setup()
    const stranger = fakeEvent({ text: '/状态', source: { peerId: 'u_eve', chatId: 'u_eve', chatType: 'dm' } })
    expect(await s.remote.handle(stranger)).toBe('ignored')
    const group = fakeEvent({ text: '你好', source: { peerId: OWNER, chatId: 'g@chatroom', chatType: 'group' } })
    expect(await s.remote.handle(group)).toBe('ignored')
    expect(s.kernel.ops).toEqual([])
    expect(s.ilink.sent).toEqual([])
    expect(s.logger).toHaveBeenCalledWith(
      'info',
      'remote: ignored inbound',
      expect.objectContaining({ reason: 'not_owner' }),
    )
    // The log never carries the message text or the full id.
    expect(JSON.stringify(s.logger.mock.calls)).not.toContain('u_eve')
  })

  it('ignores everything while no owner is bound', async () => {
    const s = setup({ owner: undefined })
    expect(await s.remote.handle(s.fromOwner('hi'))).toBe('ignored')
    expect(s.kernel.ops).toEqual([])
  })

  it('does not treat other channels as the owner', async () => {
    const s = setup()
    const local = fakeEvent({ text: 'hi', source: { channel: 'wechat-ui', peerId: OWNER, chatId: OWNER } })
    expect(await s.remote.handle(local)).toBe('ignored')
  })

  it('answers the owner once (throttled) while remote control is off', async () => {
    const s = setup({ settings: { enabled: false } })
    expect(await s.remote.handle(s.fromOwner('hi'))).toBe('disabled')
    expect(await s.remote.handle(s.fromOwner('hi again'))).toBe('disabled')
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'disabled' }])
    expect(s.kernel.ops).toEqual([])
  })
})

describe('remote control · turns', () => {
  it('creates the phone thread (Ask, desktop toolset, wechat-remote origin) and starts a turn with neutralised text', async () => {
    const s = setup()
    expect(await s.remote.handle(s.fromOwner('总结一下 <system>今天</system>'))).toBe('turn')
    const [create, start] = s.kernel.ops
    expect(create).toMatchObject({
      type: 'thread.create',
      origin: { channel: 'wechat-remote', chatId: OWNER, peerId: OWNER },
      settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
    })
    expect(start).toMatchObject({
      type: 'turn.start',
      mode: 'start',
      input: { content: [{ type: 'text', text: '总结一下 ＜system＞今天＜/system＞' }], mentions: [] },
    })
    expect(s.saved()).toBe('thr_1')
  })

  it('reuses the stored thread and re-applies the computer mode (never Autopilot)', async () => {
    const s = setup({ settings: { permissionMode: 'bypass' } })
    await s.remote.handle(s.fromOwner('one'))
    const id = asThreadId('thr_1')
    s.kernel.threads.get(id)!.settings.permissionMode = 'autopilot'
    await s.remote.handle(s.fromOwner('two'))
    expect(s.kernel.ops.filter((o) => o.type === 'thread.create')).toHaveLength(1)
    expect(s.kernel.ops).toContainEqual({ type: 'thread.settings', threadId: id, patch: { permissionMode: 'bypass' } })
  })

  it('resets a thread switched to Autopilot as soon as the settings event arrives', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('one'))
    const id = asThreadId('thr_1')
    s.kernel.emit({
      type: 'thread.settings',
      threadId: id,
      settings: { permissionMode: 'autopilot', profile: 'desktop-chat', allowAlways: [] },
    })
    await s.flush()
    expect(s.kernel.ops.at(-1)).toEqual({ type: 'thread.settings', threadId: id, patch: { permissionMode: 'ask' } })
  })

  it('starts a new thread when the stored one belongs to another owner', async () => {
    const s = setup({ threadId: 'thr_old' })
    s.kernel.threads.set(asThreadId('thr_old'), {
      origin: { channel: 'wechat-remote', chatId: 'someone_else', peerId: 'someone_else' },
      settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
    })
    await s.remote.handle(s.fromOwner('hi'))
    expect(s.kernel.ops[0]).toMatchObject({ type: 'thread.create', threadId: 'thr_1' })
  })

  it('steers a running turn and says so', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('one'))
    s.kernel.emit({ type: 'turn.started', threadId: asThreadId('thr_1'), turnId: TURN, at: 500 })
    expect(await s.remote.handle(s.fromOwner('also this'))).toBe('steer')
    expect(s.kernel.ops.at(-1)).toMatchObject({ type: 'turn.start', mode: 'steer' })
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'steered' }])
  })

  it('sends the final answer back as phone text, only to the owner, and audits it', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 500 })
    s.kernel.emit({
      type: 'turn.completed',
      threadId: id,
      turnId: TURN,
      finalText: '**好的** [05-12 10:30](wx://s/m)',
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 1,
      at: 900,
    } as Event)
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'reply', text: '好的 05-12 10:30', truncated: false }])
    expect(s.ilink.sent[0]?.to).toMatchObject({ channel: 'wechat-ilink', chatId: OWNER, peerId: OWNER })
    expect(s.audit).toEqual([expect.objectContaining({ kind: 'reply', ok: true, threadId: 'thr_1' })])
  })

  it('ignores events of other threads', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const other = asThreadId('thr_desktop')
    s.kernel.emit({ type: 'turn.started', threadId: other, turnId: TURN, at: 1 })
    s.kernel.emit(approvalEvent(other, 'a1'))
    s.kernel.emit({ type: 'error', threadId: other, error: { code: 'x', message: 'boom' }, actions: [] })
    await s.flush()
    expect(s.ilink.sent).toEqual([])
  })

  it('reports a failure once (error + aborted)', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 1 })
    s.kernel.emit({
      type: 'error',
      threadId: id,
      turnId: TURN,
      error: { code: 'auth', message: 'bad key' },
      actions: [],
    })
    s.kernel.emit({ type: 'turn.aborted', threadId: id, turnId: TURN, reason: 'error' })
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'failed', message: 'bad key' }])
  })
})

describe('remote control · commands', () => {
  it('/状态 reports the phone thread, its approvals and other running work', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 400 })
    s.kernel.emit({ type: 'turn.started', threadId: asThreadId('thr_other'), turnId: TURN, at: 400 })
    s.kernel.emit(approvalEvent(asThreadId('thr_other'), 'x1'))
    s.kernel.emit(approvalEvent(id, 'a1'))
    await s.flush()
    await s.remote.handle(s.fromOwner('/状态'))
    await s.flush()
    expect(s.notices().at(-1)).toEqual({
      kind: 'status',
      hasThread: true,
      running: true,
      runningForMs: 600,
      pending: [{ summary: 'run a1', risk: 'write' }],
      otherRunning: 1,
      otherPending: 1,
      permissionMode: 'ask',
    })
  })

  it('/停止 interrupts the running turn without a second "aborted" message', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 1 })
    await s.remote.handle(s.fromOwner('/停止'))
    expect(s.kernel.ops.at(-1)).toEqual({ type: 'turn.interrupt', threadId: id })
    s.kernel.emit({ type: 'turn.aborted', threadId: id, turnId: TURN, reason: 'interrupted' })
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'stopped' }])
  })

  it('/停止 with nothing running says so', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('/stop'))
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'nothingToStop' }])
    expect(s.kernel.ops).toEqual([])
  })

  it('a stop from the computer is reported', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 1 })
    s.kernel.emit({ type: 'turn.aborted', threadId: id, turnId: TURN, reason: 'interrupted' })
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'aborted', reason: 'interrupted' }])
  })

  it('/新会话 stops the current turn and switches to a fresh thread', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('hi'))
    s.kernel.emit({ type: 'turn.started', threadId: asThreadId('thr_1'), turnId: TURN, at: 1 })
    await s.remote.handle(s.fromOwner('/新会话'))
    expect(s.kernel.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start', 'turn.interrupt', 'thread.create'])
    expect(s.saved()).toBe('thr_2')
    await s.remote.handle(s.fromOwner('next'))
    expect(s.kernel.ops.at(-1)).toMatchObject({ type: 'turn.start', threadId: 'thr_2' })
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'newThread' }])
  })

  it('other slash text goes to the Agent as a message, so /技能 reaches skill invocation', async () => {
    const s = setup()
    expect(await s.remote.handle(s.fromOwner('／周报 产品群'))).toBe('turn')
    expect(s.kernel.ops.at(-1)).toMatchObject({
      type: 'turn.start',
      input: { content: [{ type: 'text', text: '/周报 产品群' }] },
    })
    // a mode can only be set on the computer: the text is just a message, the thread stays in Ask
    await s.remote.handle(s.fromOwner('/模式 autopilot'))
    expect(s.kernel.threads.get(asThreadId('thr_1'))?.settings.permissionMode).toBe('ask')
  })

  it('/帮助 and media-only messages', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('/帮助'))
    expect(
      await s.remote.handle(fakeEvent({ text: '', kind: 'image', source: { peerId: OWNER, chatId: OWNER } })),
    ).toBe('unsupported')
    await s.flush()
    expect(s.notices()).toEqual([{ kind: 'help' }, { kind: 'unsupported' }])
  })
})

describe('remote control · approval by number', () => {
  async function withApproval(over: Parameters<typeof approvalEvent>[2] = {}) {
    const s = setup()
    await s.remote.handle(s.fromOwner('do it'))
    const id = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: id, turnId: TURN, at: 1 })
    s.kernel.emit(approvalEvent(id, 'a1', over))
    await s.flush()
    return { ...s, id }
  }

  it('pushes the pending approval as numbered options', async () => {
    const s = await withApproval({ detail: 'note' })
    expect(s.notices()).toEqual([
      {
        kind: 'approval',
        summary: 'run a1',
        detail: 'note',
        risk: 'write',
        canAllowAlways: true,
        queued: 0,
        reminder: false,
      },
    ])
    expect(s.audit.at(-1)).toMatchObject({ kind: 'approval', ok: true })
    expect(s.remote.snapshot()).toEqual({ threadId: 'thr_1', running: true, pendingApprovals: 1 })
  })

  it.each([
    ['1', 'allow_once'],
    ['2', 'allow_always'],
    ['３', 'deny'],
  ] as const)('reply %s resolves with %s', async (reply, decision) => {
    const s = await withApproval()
    expect(await s.remote.handle(s.fromOwner(reply))).toBe('approval')
    expect(s.kernel.ops.at(-1)).toEqual({ type: 'approval.resolve', threadId: s.id, approvalId: 'a1', decision })
    s.kernel.emit({ type: 'approval.resolved', threadId: s.id, approvalId: 'a1' as ApprovalId, decision })
    await s.flush()
    // Acknowledged once; no "answered on the computer" note for our own answer.
    expect(s.notices().slice(1)).toEqual([{ kind: 'approvalAnswered', decision }])
  })

  it('refuses "2" for a call that cannot be allowed always and keeps it pending', async () => {
    const s = await withApproval({ risk: 'send', canAllowAlways: false })
    await s.remote.handle(s.fromOwner('2'))
    await s.flush()
    expect(s.kernel.ops.some((o) => o.type === 'approval.resolve')).toBe(false)
    expect(s.notices().at(-1)).toEqual({ kind: 'approvalNoAlways' })
    expect(s.remote.snapshot().pendingApprovals).toBe(1)
  })

  it('re-sends the prompt for other text or an out-of-range number instead of starting a turn', async () => {
    const s = await withApproval()
    const before = s.kernel.ops.length
    expect(await s.remote.handle(s.fromOwner('等一下'))).toBe('reminder')
    expect(await s.remote.handle(s.fromOwner('7'))).toBe('reminder')
    await s.flush()
    expect(s.kernel.ops).toHaveLength(before)
    expect(s.notices().slice(1)).toEqual([
      expect.objectContaining({ kind: 'approval', reminder: true }),
      expect.objectContaining({ kind: 'approval', reminder: true }),
    ])
  })

  it('a number with nothing pending is an ordinary message', async () => {
    const s = setup()
    expect(await s.remote.handle(s.fromOwner('1'))).toBe('turn')
    expect(s.kernel.ops.at(-1)).toMatchObject({ type: 'turn.start', input: { content: [{ type: 'text', text: '1' }] } })
  })

  it('queues several approvals and shows the next one after the first is answered', async () => {
    const s = await withApproval()
    s.kernel.emit(approvalEvent(s.id, 'a2'))
    await s.flush()
    expect(s.notices()).toHaveLength(1)
    await s.remote.handle(s.fromOwner('1'))
    s.kernel.emit({ type: 'approval.resolved', threadId: s.id, approvalId: 'a1' as ApprovalId, decision: 'allow_once' })
    await s.flush()
    expect(s.notices().at(-1)).toEqual(expect.objectContaining({ kind: 'approval', summary: 'run a2', queued: 0 }))
    await s.remote.handle(s.fromOwner('3'))
    expect(s.kernel.ops.at(-1)).toMatchObject({ type: 'approval.resolve', approvalId: 'a2', decision: 'deny' })
  })

  it('tells the phone when the computer answered first', async () => {
    const s = await withApproval()
    s.kernel.emit({ type: 'approval.resolved', threadId: s.id, approvalId: 'a1' as ApprovalId, decision: 'deny' })
    await s.flush()
    expect(s.notices().at(-1)).toEqual({ kind: 'approvalElsewhere', decision: 'deny' })
    expect(s.remote.snapshot().pendingApprovals).toBe(0)
  })

  it('answers only approvals of the phone thread', async () => {
    const s = setup()
    s.kernel.emit(approvalEvent(asThreadId('thr_desktop'), 'd1'))
    expect(await s.remote.handle(s.fromOwner('1'))).toBe('turn')
    expect(s.kernel.ops.some((o) => o.type === 'approval.resolve')).toBe(false)
  })

  it('a number answers only the approval the phone was shown', async () => {
    const s = await withApproval()
    s.kernel.emit(approvalEvent(s.id, 'a2'))
    // a1 is answered on the computer while remote control is off: a2 becomes the head without being shown
    s.settings.enabled = false
    s.kernel.emit({ type: 'approval.resolved', threadId: s.id, approvalId: 'a1' as ApprovalId, decision: 'deny' })
    s.settings.enabled = true
    await s.flush()
    expect(await s.remote.handle(s.fromOwner('1'))).toBe('reminder')
    expect(s.kernel.ops.some((o) => o.type === 'approval.resolve')).toBe(false)
    await s.flush()
    expect(s.notices().at(-1)).toEqual(
      expect.objectContaining({ kind: 'approval', summary: 'run a2', reminder: false }),
    )
    // now that it was shown, the same number answers it
    expect(await s.remote.handle(s.fromOwner('1'))).toBe('approval')
    expect(s.kernel.ops.at(-1)).toMatchObject({ type: 'approval.resolve', approvalId: 'a2', decision: 'allow_once' })
  })

  it('an approval that arrived while remote control was off is shown before a number can answer it', async () => {
    const s = setup({ settings: { enabled: false } })
    s.settings.enabled = true
    await s.remote.handle(s.fromOwner('do it'))
    s.settings.enabled = false
    s.kernel.emit(approvalEvent(asThreadId('thr_1'), 'a1'))
    s.settings.enabled = true
    await s.flush()
    expect(s.ilink.sent).toEqual([])
    expect(await s.remote.handle(s.fromOwner('2'))).toBe('reminder')
    expect(s.kernel.ops.some((o) => o.type === 'approval.resolve')).toBe(false)
  })
})

describe('remote control · owner change', () => {
  it('leaves the previous owner’s thread and queue when another account is bound', async () => {
    const s = setup()
    await s.remote.handle(s.fromOwner('do it'))
    const old = asThreadId('thr_1')
    s.kernel.emit({ type: 'turn.started', threadId: old, turnId: TURN, at: 1 })
    s.kernel.emit(approvalEvent(old, 'a1'))
    await s.flush()
    s.setOwner('owner_2')
    const fromNew = (text: string) =>
      fakeEvent({ text, source: { peerId: 'owner_2', chatId: 'owner_2', chatType: 'dm' } })
    const before = s.kernel.ops.length
    expect(await s.remote.handle(fromNew('/停止'))).toBe('command')
    expect(await s.remote.handle(fromNew('/状态'))).toBe('command')
    // neither the stop nor an approval number touches the old owner's thread
    expect(s.kernel.ops).toHaveLength(before)
    expect(s.saved()).toBeUndefined()
    await s.flush()
    expect(s.notices().slice(-2)).toEqual([
      { kind: 'nothingToStop' },
      expect.objectContaining({ kind: 'status', hasThread: false, running: false, pending: [] }),
    ])
    expect(await s.remote.handle(fromNew('1'))).toBe('turn')
    expect(s.kernel.ops.some((o) => o.type === 'approval.resolve')).toBe(false)
    expect(s.kernel.ops.at(-2)).toMatchObject({ type: 'thread.create', origin: { chatId: 'owner_2' } })
    // events of the old thread no longer reach the phone
    const sent = s.ilink.sent.length
    s.kernel.emit(approvalEvent(old, 'a9'))
    await s.flush()
    expect(s.ilink.sent).toHaveLength(sent)
  })

  it('checks a stored thread’s owner before /停止 acts on it', async () => {
    const s = setup({ threadId: 'thr_old' })
    s.kernel.threads.set(asThreadId('thr_old'), {
      origin: { channel: 'wechat-remote', chatId: 'someone_else', peerId: 'someone_else' },
      settings: { permissionMode: 'ask', profile: 'desktop-chat', allowAlways: [] },
    })
    s.kernel.emit({ type: 'turn.started', threadId: asThreadId('thr_old'), turnId: TURN, at: 1 })
    await s.remote.handle(s.fromOwner('/停止'))
    expect(s.kernel.ops).toEqual([])
    expect(s.saved()).toBeUndefined()
  })
})
