/**
 * 我的微信 › 遥控: the owner drives one dedicated Agent thread (origin 'wechat-remote') from the private chat with
 * their own iLink bot.
 *
 *   inbound ─▶ owner gate (everything else ignored + logged) ─▶ enabled? ─▶ command / approval number / message
 *   message ─▶ turn.start on the phone thread (steer when a turn is running)
 *   kernel events of that thread ─▶ approval prompts (numbered), the final answer, stops and failures ─▶ owner
 *
 * The thread runs the desktop toolset under the permission mode set on the computer (Ask by default, Bypass at
 * most): it is re-applied before every turn and whenever the thread's settings change, so Autopilot can never be
 * reached from the phone. Everything it sends goes through the owner channel, i.e. back to this one chat.
 * The package has no UI language: replies are `RemoteNotice` codes the host words (`format`).
 */
import {
  newClientInputId,
  newThreadId,
  type ApprovalDecision,
  type ApprovalId,
  type Event,
  type MessageEvent,
  type MobileRemoteMode,
  type MobileRemoteSettings,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type ToolRisk,
} from '@aiwc/protocol'
import { checkOwnerMessage, maskId } from './ownerGate'
import type { OwnerChannel } from './ownerChannel'
import { remoteInputText, toPhoneText } from './phoneText'
import { decisionForChoice, parseRemoteCommand } from './remoteCommands'

/** At most one "remote control is off" reply per this interval, however often the owner writes. */
const DISABLED_NOTICE_INTERVAL_MS = 10 * 60_000

export type RemoteNotice =
  | { kind: 'help' }
  | {
      kind: 'status'
      hasThread: boolean
      running: boolean
      runningForMs?: number
      pending: Array<{ summary: string; risk: ToolRisk }>
      otherRunning: number
      otherPending: number
      permissionMode: MobileRemoteMode
    }
  | { kind: 'stopped' }
  | { kind: 'nothingToStop' }
  | { kind: 'newThread' }
  | { kind: 'steered' }
  | {
      kind: 'approval'
      summary: string
      detail?: string
      risk: ToolRisk
      canAllowAlways: boolean
      /** More approvals waiting behind this one. */
      queued: number
      /** Sent again because the owner wrote something else while it waited. */
      reminder: boolean
    }
  | { kind: 'approvalAnswered'; decision: ApprovalDecision }
  | { kind: 'approvalNoAlways' }
  | { kind: 'approvalElsewhere'; decision: ApprovalDecision }
  | { kind: 'reply'; text: string; truncated: boolean }
  | { kind: 'doneEmpty' }
  | { kind: 'aborted'; reason: string }
  | { kind: 'failed'; message: string }
  | { kind: 'unsupported' }
  | { kind: 'disabled' }

export type RemoteOutcome =
  'ignored' | 'disabled' | 'unsupported' | 'command' | 'approval' | 'reminder' | 'turn' | 'steer'

/** The slice of the kernel this service drives (the real Kernel satisfies it structurally). */
export interface RemoteKernel {
  submit(op: Op): Promise<void>
  events: { on(listener: (e: Event) => void): () => void }
  getThread(
    threadId: ThreadId,
  ): Promise<{ running: boolean; record: { origin: ThreadOrigin; settings: ThreadSettings } } | undefined>
}

export interface RemoteControlDeps {
  kernel: RemoteKernel
  channel: OwnerChannel
  /** The owner bound at login (iLink user id). */
  ownerId(): string | undefined
  settings(): MobileRemoteSettings
  /** Model for a new phone thread; undefined = the app default. */
  model?(): ThreadSettings['model']
  threadTitle(): string
  loadThreadId(): ThreadId | undefined
  saveThreadId(threadId: ThreadId | undefined): void
  format(notice: RemoteNotice): string
  /** Running / pending / thread changed: the host re-publishes its status. */
  onChange?(): void
  newThreadId?: () => ThreadId
  now?: () => number
  disabledNoticeIntervalMs?: number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface RemoteControl {
  handle(event: MessageEvent): Promise<RemoteOutcome>
  snapshot(): { threadId?: ThreadId; running: boolean; pendingApprovals: number }
  dispose(): void
}

interface PendingApproval {
  threadId: ThreadId
  summary: string
  detail?: string
  risk: ToolRisk
  canAllowAlways: boolean
}

const remoteMode = (settings: MobileRemoteSettings): MobileRemoteMode =>
  settings.permissionMode === 'bypass' ? 'bypass' : 'ask'

export function createRemoteControl(deps: RemoteControlDeps): RemoteControl {
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const makeThreadId = deps.newThreadId ?? newThreadId
  const disabledInterval = deps.disabledNoticeIntervalMs ?? DISABLED_NOTICE_INTERVAL_MS

  let threadId: ThreadId | undefined = deps.loadThreadId()
  /** Whose phone thread `threadId` is (its origin chatId); undefined until checked against the kernel. */
  let threadOwner: string | undefined
  /** The approval last shown on the phone: a number answers only this one, never a head the owner has not seen. */
  let prompted: ApprovalId | undefined
  const running = new Map<ThreadId, number>()
  const pending = new Map<ApprovalId, PendingApproval>()
  /** Approvals answered (or cancelled) from the phone: their resolution needs no "answered elsewhere" note. */
  const answeredHere = new Set<ApprovalId>()
  /** Threads whose turn the phone stopped: the abort was already acknowledged. */
  const stopRequested = new Set<ThreadId>()
  /** Threads whose current turn already reported a failure (an 'error' is followed by an aborted turn). */
  const failed = new Set<ThreadId>()
  let lastDisabledNotice = Number.NEGATIVE_INFINITY

  // Phone messages leave in the order they were decided, whatever each send takes.
  let sending: Promise<unknown> = Promise.resolve()
  const say = (notice: RemoteNotice, kind: 'reply' | 'approval' | 'notice' = 'notice'): Promise<void> => {
    const text = deps.format(notice)
    const job = sending.then(async () => {
      const result = await deps.channel.send(text, { kind, threadId })
      if (!result.ok) log('warn', 'remote: reply to owner not sent', { kind: notice.kind, error: result.error })
    })
    sending = job.catch(() => undefined)
    return job.catch((err) => log('warn', 'remote: reply to owner failed', err))
  }

  const changed = (): void => {
    try {
      deps.onChange?.()
    } catch (err) {
      log('warn', 'remote: onChange threw', err)
    }
  }

  const pendingOf = (id: ThreadId | undefined): Array<[ApprovalId, PendingApproval]> =>
    id ? [...pending].filter(([, p]) => p.threadId === id) : []

  const promptFor = (approval: PendingApproval, queued: number, reminder: boolean): RemoteNotice => ({
    kind: 'approval',
    summary: approval.summary,
    detail: approval.detail,
    risk: approval.risk,
    canAllowAlways: approval.canAllowAlways,
    queued,
    reminder,
  })

  const promptHead = (reminder: boolean): Promise<void> | undefined => {
    const list = pendingOf(threadId)
    const head = list[0]
    if (!head) return undefined
    prompted = head[0]
    return say(promptFor(head[1], list.length - 1, reminder), 'approval')
  }

  /** Forget the phone thread (another owner's, or gone): its queue, stop and status are not this owner's. */
  const dropThread = (): void => {
    if (!threadId) return
    for (const [approvalId] of pendingOf(threadId)) pending.delete(approvalId)
    threadId = undefined
    threadOwner = undefined
    prompted = undefined
    deps.saveThreadId(undefined)
    changed()
  }

  /** A different owner is bound now: drop the old owner's thread before anything of it reaches the new one. */
  const ownerMoved = (): boolean => {
    const owner = deps.ownerId()
    if (threadOwner === undefined || owner === undefined || owner === threadOwner) return false
    log('info', 'remote: the bound owner changed; leaving the previous phone thread')
    dropThread()
    return true
  }

  /** Learn whose the stored thread is from its origin; a thread that is not a phone thread is dropped. */
  const verifyThread = async (): Promise<void> => {
    const id = threadId
    if (!id || threadOwner !== undefined) return
    const origin = (await deps.kernel.getThread(id))?.record.origin
    if (threadId !== id) return
    if (origin?.channel === 'wechat-remote' && origin.chatId) threadOwner = origin.chatId
    else dropThread()
  }

  /** Stop the phone thread's turn; its pending approvals are cancelled by the kernel, not answered elsewhere. */
  const interrupt = async (id: ThreadId): Promise<void> => {
    stopRequested.add(id)
    for (const [approvalId] of pendingOf(id)) answeredHere.add(approvalId)
    await deps.kernel.submit({ type: 'turn.interrupt', threadId: id })
  }

  const createThread = async (owner: string, mode: MobileRemoteMode): Promise<ThreadId> => {
    const id = makeThreadId()
    const model = deps.model?.()
    await deps.kernel.submit({
      type: 'thread.create',
      threadId: id,
      origin: { channel: 'wechat-remote', chatId: owner, peerId: owner },
      settings: {
        permissionMode: mode,
        profile: 'desktop-chat',
        // Nothing pre-approved from the desktop: 总是允许 answered on the phone builds this thread's own list.
        allowAlways: [],
        title: deps.threadTitle(),
        ...(model ? { model } : {}),
      },
    })
    threadId = id
    threadOwner = owner
    prompted = undefined
    deps.saveThreadId(id)
    changed()
    return id
  }

  /** The phone thread for this owner, with the computer's permission mode re-applied. */
  const ensureThread = async (owner: string): Promise<ThreadId> => {
    const mode = remoteMode(deps.settings())
    if (threadId) {
      const existing = await deps.kernel.getThread(threadId)
      const origin = existing?.record.origin
      if (existing && origin?.channel === 'wechat-remote' && origin.chatId === owner) {
        if (existing.record.settings.permissionMode !== mode)
          await deps.kernel.submit({ type: 'thread.settings', threadId, patch: { permissionMode: mode } })
        return threadId
      }
    }
    return createThread(owner, mode)
  }

  const statusNotice = (): RemoteNotice => {
    const startedAt = threadId ? running.get(threadId) : undefined
    const mine = pendingOf(threadId)
    return {
      kind: 'status',
      hasThread: threadId !== undefined,
      running: startedAt !== undefined,
      ...(startedAt !== undefined ? { runningForMs: Math.max(0, now() - startedAt) } : {}),
      pending: mine.map(([, p]) => ({ summary: p.summary, risk: p.risk })),
      otherRunning: [...running.keys()].filter((id) => id !== threadId).length,
      otherPending: pending.size - mine.length,
      permissionMode: remoteMode(deps.settings()),
    }
  }

  const answer = async (n: number): Promise<RemoteOutcome | undefined> => {
    const head = pendingOf(threadId)[0]
    if (!head || !threadId) return undefined
    const [approvalId, approval] = head
    // The head moved since the phone was last prompted (answered on the computer, or it arrived while remote
    // control was off): show it first rather than let a number meant for another approval resolve it.
    if (approvalId !== prompted) {
      await promptHead(false)
      return 'reminder'
    }
    const decision = decisionForChoice(n, approval.canAllowAlways)
    if (decision === undefined) {
      await promptHead(true)
      return 'reminder'
    }
    if (decision === 'unavailable') {
      await say({ kind: 'approvalNoAlways' })
      return 'approval'
    }
    answeredHere.add(approvalId)
    try {
      await deps.kernel.submit({ type: 'approval.resolve', threadId, approvalId, decision })
    } catch (err) {
      answeredHere.delete(approvalId)
      log('warn', 'remote: approval.resolve failed', err)
    }
    await say({ kind: 'approvalAnswered', decision })
    return 'approval'
  }

  const process = async (event: MessageEvent): Promise<RemoteOutcome> => {
    if (event.source.channel !== 'wechat-ilink') return 'ignored'
    const owner = deps.ownerId()
    const verdict = checkOwnerMessage(event, owner)
    if (!verdict.ok || !owner) {
      log('info', 'remote: ignored inbound', {
        reason: verdict.ok ? 'no_owner' : verdict.reason,
        peer: maskId(event.source.peerId),
        chatType: event.source.chatType,
      })
      return 'ignored'
    }
    if (!deps.settings().enabled) {
      if (now() - lastDisabledNotice >= disabledInterval) {
        lastDisabledNotice = now()
        await say({ kind: 'disabled' })
      }
      return 'disabled'
    }
    const text = event.text.trim()
    if (!text) {
      await say({ kind: 'unsupported' })
      return 'unsupported'
    }
    // Status, stop, approvals and the next turn act only on this owner's own phone thread.
    await verifyThread()
    ownerMoved()

    const command = parseRemoteCommand(text)
    let message = text
    switch (command.type) {
      case 'help':
        await say({ kind: 'help' })
        return 'command'
      case 'status':
        await say(statusNotice())
        return 'command'
      case 'stop': {
        if (threadId && running.has(threadId)) {
          await interrupt(threadId)
          await say({ kind: 'stopped' })
        } else await say({ kind: 'nothingToStop' })
        return 'command'
      }
      case 'new': {
        if (threadId && running.has(threadId)) await interrupt(threadId)
        await createThread(owner, remoteMode(deps.settings()))
        await say({ kind: 'newThread' })
        return 'command'
      }
      case 'choice': {
        const outcome = await answer(command.n)
        if (outcome) return outcome
        break
      }
      case 'message':
        message = command.text
        break
    }

    // A message while an approval waits would only queue behind it: ask for the answer first.
    if (pendingOf(threadId).length > 0) {
      await promptHead(true)
      return 'reminder'
    }
    const id = await ensureThread(owner)
    const steer = running.has(id)
    await deps.kernel.submit({
      type: 'turn.start',
      threadId: id,
      input: { content: [{ type: 'text', text: remoteInputText(message) }], mentions: [] },
      mode: steer ? 'steer' : 'start',
      clientInputId: newClientInputId(),
    })
    if (steer) await say({ kind: 'steered' })
    return steer ? 'steer' : 'turn'
  }

  const onEvent = (e: Event): void => {
    if ('threadId' in e && e.threadId === threadId) ownerMoved()
    switch (e.type) {
      case 'turn.started':
        running.set(e.threadId, e.at)
        failed.delete(e.threadId)
        if (e.threadId === threadId) changed()
        return
      case 'approval.requested': {
        pending.set(e.approvalId, {
          threadId: e.threadId,
          summary: e.summary,
          detail: e.detail,
          risk: e.risk,
          canAllowAlways: e.canAllowAlways,
        })
        if (e.threadId !== threadId) return
        changed()
        // Only the head is shown; the next one follows when it is answered.
        if (pendingOf(threadId).length === 1 && deps.settings().enabled) void promptHead(false)
        return
      }
      case 'approval.resolved': {
        const entry = pending.get(e.approvalId)
        pending.delete(e.approvalId)
        const here = answeredHere.delete(e.approvalId)
        if (!entry || entry.threadId !== threadId) return
        changed()
        if (!deps.settings().enabled) return
        if (!here) void say({ kind: 'approvalElsewhere', decision: e.decision })
        void promptHead(false)
        return
      }
      case 'thread.settings':
        // Autopilot (or any mode above the computer's setting) never sticks on the phone thread.
        if (e.threadId === threadId && e.settings.permissionMode !== remoteMode(deps.settings()))
          void deps.kernel
            .submit({
              type: 'thread.settings',
              threadId: e.threadId,
              patch: { permissionMode: remoteMode(deps.settings()) },
            })
            .catch((err) => log('warn', 'remote: could not reset the permission mode', err))
        return
      case 'turn.completed': {
        running.delete(e.threadId)
        stopRequested.delete(e.threadId)
        if (e.threadId !== threadId) return
        changed()
        if (!deps.settings().enabled) return
        const shaped = toPhoneText(e.finalText)
        void say(shaped.text ? { kind: 'reply', ...shaped } : { kind: 'doneEmpty' }, 'reply')
        return
      }
      case 'turn.aborted': {
        running.delete(e.threadId)
        const acknowledged = stopRequested.delete(e.threadId)
        const reported = failed.delete(e.threadId)
        if (e.threadId !== threadId) return
        changed()
        // 'replaced' = a steer took over the turn; the new turn reports for both.
        if (acknowledged || e.reason === 'replaced' || (e.reason === 'error' && reported)) return
        if (deps.settings().enabled) void say({ kind: 'aborted', reason: e.reason })
        return
      }
      case 'error':
        if (e.threadId !== threadId) return
        failed.add(e.threadId)
        if (deps.settings().enabled) void say({ kind: 'failed', message: e.error.message })
        return
      default:
        return
    }
  }
  const unsubscribe = deps.kernel.events.on(onEvent)
  void verifyThread().catch((err) => log('warn', 'remote: could not check the stored phone thread', err))

  // Inbound is handled one message at a time, in arrival order.
  let chain: Promise<unknown> = Promise.resolve()
  return {
    handle(event) {
      const job = chain.then(() => process(event))
      chain = job.catch((err) => log('error', 'remote: handling an owner message failed', err))
      return job
    },
    snapshot() {
      return {
        threadId,
        running: threadId !== undefined && running.has(threadId),
        pendingApprovals: pendingOf(threadId).length,
      }
    },
    dispose() {
      unsubscribe()
    },
  }
}
