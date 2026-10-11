/**
 * Kernel façade (docs/PACKAGE-API.md). Threads are loaded lazily from the RolloutStore; runOnce is the
 * convenience used by gateway / cron; runChild backs the delegate tool.
 */
import {
  newThreadId,
  type ChannelKind,
  type Event,
  type HistoryItem,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type ToolArtifact,
  type ToolProfile,
  type UserInput,
} from '@aiwc/protocol'
import type { RolloutLine, RolloutStore, ThreadRecord } from '../ports'
import { createEmitter } from './emitter'
import { trackPendingAsks } from './pendingAsks'
import { forkItems } from './fork'
import { postAssistantNote } from './notes'
import { Thread, type ThreadDeps } from './thread'
import { childEventBridge } from './childBridge'
import { buildSubagentTrace, watchApprovalWaits } from './childRun'
import type { ChildRunOptions, KernelInternal, KernelOptions } from './types'

export function profileForChannel(channel: ChannelKind): ToolProfile {
  switch (channel) {
    case 'desktop':
      return 'desktop-chat'
    case 'cron':
      return 'cron'
    // The owner at their own phone: the desktop toolset, asking for approval in the chat (permission mode Ask by default).
    case 'wechat-remote':
      return 'desktop-chat'
    case 'wechat-ilink':
    case 'wechat-ui':
    case 'observed':
      return 'wechat-bot'
  }
}

/**
 * A group origin carries the sender (peerId) next to the room (chatId); a DM carries peerId === chatId or none.
 * Bot threads are keyed per (channel, chatId, peerId) for groups and per (channel, chatId) for DMs.
 */
export const isGroupOrigin = (origin: ThreadOrigin): boolean =>
  !!origin.chatId && !!origin.peerId && origin.peerId !== origin.chatId

export const sameBotOrigin = (a: ThreadOrigin, b: ThreadOrigin): boolean => {
  if (a.channel !== b.channel || !a.chatId || a.chatId !== b.chatId) return false
  return isGroupOrigin(b) ? a.peerId === b.peerId : !isGroupOrigin(a)
}

const botThreadKey = (origin: ThreadOrigin): string =>
  isGroupOrigin(origin) ? `${origin.channel}:${origin.chatId}:${origin.peerId}` : `${origin.channel}:${origin.chatId}`

/**
 * Profiles whose threads belong to the kernel rather than to any conversation list. Lookups exclude them, so a
 * delegate child an older build persisted (and a crash never removed) cannot show up as a dead conversation.
 */
const UNLISTED_PROFILES: readonly ToolProfile[] = ['subagent']

/**
 * Store for delegate children: their history lives in memory for their single run, so nothing reaches the
 * rollout files, the listing index or search, and a crash mid-delegate leaves nothing behind.
 */
const EPHEMERAL_ROLLOUT: RolloutStore = {
  create: () => Promise.resolve(),
  append: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  resume: () => Promise.resolve(undefined),
  list: () => Promise.resolve([]),
  updateMeta: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  search: () => Promise.resolve([]),
}

export function createKernel(opts: KernelOptions): KernelInternal {
  const { services } = opts
  const logger = opts.logger
  const emitter = createEmitter((err) => logger?.('warn', 'event listener threw', err))
  const pendingAsks = trackPendingAsks(emitter.on)
  const threads = new Map<ThreadId, Thread>()
  const loading = new Map<ThreadId, Promise<Thread | undefined>>()
  /** In-flight ensureThread lookups per bot chat, so concurrent inbound messages share one thread. */
  const ensuring = new Map<string, Promise<ThreadId>>()
  let closed = false

  const threadDeps = (extra?: Pick<ThreadDeps, 'depth' | 'maxSteps'>): ThreadDeps => ({
    services,
    config: opts.config,
    systemPrompt: opts.systemPrompt,
    emit: emitter.emit,
    logger,
    onGlobalGrant: opts.onGlobalGrant,
    ...extra,
  })

  /**
   * Headless origins (wechat / cron / observed) have nobody at the keyboard to answer an approval popover, so
   * they default to 'bypass'; the channel matrix (ApprovalGate.decide) already caps what they may do. Desktop
   * threads follow the user's configured default. Callers can still override via `patch`.
   */
  const defaultSettings = (origin: ThreadOrigin, patch?: Partial<ThreadSettings>): ThreadSettings => {
    const config = opts.config()
    return {
      permissionMode: origin.channel === 'desktop' ? config.defaultPermissionMode : 'bypass',
      profile: profileForChannel(origin.channel),
      // Global grants are read live at each call (turn.ts effectiveAllowAlways), never copied: a revoke must apply
      // to threads created before it too.
      allowAlways: [],
      ...patch,
    }
  }

  const loadThread = (threadId: ThreadId): Promise<Thread | undefined> => {
    const existing = threads.get(threadId)
    if (existing) return Promise.resolve(existing)
    const pending = loading.get(threadId)
    if (pending) return pending
    const job = (async () => {
      const state = await services.rollout.resume(threadId)
      if (!state) return undefined
      if (state.skippedLines) {
        logger?.('warn', 'thread resumed without its unreadable rollout lines', {
          threadId,
          skippedLines: state.skippedLines,
        })
      }
      const again = threads.get(threadId)
      if (again) return again
      const thread = new Thread(threadDeps(), {
        threadId,
        origin: state.origin,
        settings: state.settings,
        title: state.title || undefined,
        items: state.items,
        worldState: state.worldState,
      })
      threads.set(threadId, thread)
      return thread
    })().finally(() => loading.delete(threadId))
    loading.set(threadId, job)
    return job
  }

  const requireThread = async (threadId: ThreadId): Promise<Thread> => {
    const thread = await loadThread(threadId)
    if (!thread) throw new Error(`unknown thread: ${threadId}`)
    return thread
  }

  const createThread = async (threadId: ThreadId, origin: ThreadOrigin, settings: ThreadSettings): Promise<Thread> => {
    if (threads.has(threadId)) throw new Error(`thread already exists: ${threadId}`)
    await services.rollout.create({ threadId, origin, settings, title: settings.title })
    const thread = new Thread(threadDeps(), { threadId, origin, settings })
    threads.set(threadId, thread)
    emitter.emit({ type: 'thread.created', threadId, settings, origin })
    return thread
  }

  const runToCompletion = async (
    thread: Thread,
    input: UserInput,
    signal?: AbortSignal,
  ): Promise<{ text: string; artifacts: ToolArtifact[] }> => {
    const artifacts: ToolArtifact[] = []
    const off = emitter.on((e: Event) => {
      if (e.type === 'tool.call' && e.threadId === thread.id && e.status === 'done' && e.artifacts?.length)
        artifacts.push(...e.artifacts)
    })
    try {
      const handle = await thread.startTurn(input, 'start')
      const onAbort = (): void => handle.interrupt('interrupted')
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
      const result = await handle.promise
      signal?.removeEventListener('abort', onAbort)
      if (result.status === 'completed') return { text: result.text, artifacts }
      throw Object.assign(new Error(`turn aborted: ${result.reason}`), { reason: result.reason, text: result.text })
    } finally {
      off()
    }
  }

  const kernel: KernelInternal = {
    events: { on: emitter.on },

    async submit(op: Op): Promise<void> {
      if (closed) throw new Error('kernel is shut down')
      if (op.type === 'thread.create') {
        await createThread(op.threadId, op.origin, op.settings)
        return
      }
      if (op.type === 'question.answer') {
        // Answered straight at the gate: the waiting tool call emits question.resolved itself.
        await requireThread(op.threadId)
        services.questions?.resolve(op.questionId, op.answer, op.threadId)
        return
      }
      const thread = await requireThread(op.threadId)
      await thread.submit(op)
      if (op.type === 'thread.shutdown') threads.delete(op.threadId)
    },

    async ensureThread(origin, settings, threadId) {
      if (threadId) {
        const loaded = await loadThread(threadId)
        if (loaded) return loaded.id
      }
      const create = async (): Promise<ThreadId> =>
        (await createThread(threadId ?? newThreadId(), origin, defaultSettings(origin, settings))).id
      if (origin.channel === 'desktop' || !origin.chatId) return create()

      // check-then-create is racy: two messages from the same chat (or group member) arriving before its thread
      // exists would each create one. Concurrent callers for the same key share a single in-flight lookup.
      const key = botThreadKey(origin)
      const pending = ensuring.get(key)
      if (pending) return pending
      const job = (async (): Promise<ThreadId> => {
        for (const t of threads.values()) {
          if (t.depth === 0 && sameBotOrigin(t.origin, origin)) return t.id
        }
        const records = await services.rollout.list({
          channel: origin.channel,
          limit: 500,
          excludeProfiles: UNLISTED_PROFILES,
        })
        const match = records.find((r) => sameBotOrigin(r.origin, origin))
        if (match) {
          const loaded = await loadThread(match.threadId)
          if (loaded) return loaded.id
        }
        return create()
      })().finally(() => ensuring.delete(key))
      ensuring.set(key, job)
      return job
    },

    async runOnce(threadId, input, runOpts) {
      const thread = await requireThread(threadId)
      return runToCompletion(thread, input, runOpts?.signal)
    },

    async runChild(child: ChildRunOptions) {
      // A child acts on its parent's behalf, so it is bounded like the parent: the same permission mode (never
      // wider) and the same model (a local-only thread's data must not reach the online default). Without a live
      // parent there is nothing to inherit from, so the child is refused rather than run with defaults.
      const parent = threads.get(child.parentThreadId)
      if (!parent) throw new Error(`unknown parent thread: ${child.parentThreadId}`)
      const childId = newThreadId()
      const profile = child.profile ?? 'subagent'
      const settings: ThreadSettings = {
        permissionMode: parent.settings.permissionMode,
        model: parent.settings.model,
        profile,
        // A write-capable child acts as the parent would: the user's grants for that conversation still apply.
        allowAlways: profile === 'subagent' ? [] : [...parent.settings.allowAlways],
        title: child.label,
      }
      // Registered so ops (interrupt, approvals) and kernel shutdown reach it, but never announced with
      // thread.created: the renderer lists every created thread, and a child is not a conversation.
      // The child's approval waits hold the parent's clocks (the calling tool's timeout, the workflow step's limit).
      const waits = watchApprovalWaits(
        childEventBridge(emitter.emit, { childId, parentId: child.parentThreadId, parentTurnId: child.parentTurnId }),
        childId,
        child.onApprovalWait,
      )
      const thread = new Thread(
        {
          ...threadDeps({ depth: child.depth, maxSteps: child.maxSteps }),
          emit: waits.emit,
          services: { ...services, rollout: EPHEMERAL_ROLLOUT },
        },
        { threadId: childId, origin: child.origin, settings },
      )
      threads.set(childId, thread)
      // The child's approvals are answered (and cancelled) from the parent conversation.
      const unalias = services.approvals.alias?.(childId, child.parentThreadId)
      const startedAt = (services.clock ?? Date.now)()
      // The parent's row shows the child's work under the calling tool call (live from the child's own events).
      const announce = (status: 'started' | 'done' | 'failed'): void =>
        emitter.emit({
          type: 'subagent',
          threadId: child.parentThreadId,
          childId,
          status,
          label: child.label,
          ...(child.parentCallId ? { callId: child.parentCallId } : {}),
          ...(child.step ? { step: child.step } : {}),
        })
      announce('started')
      let status: 'done' | 'failed' = 'failed'
      try {
        const result = await runToCompletion(thread, child.input, child.signal)
        status = 'done'
        return result
      } finally {
        announce(status)
        waits.stop()
        unalias?.()
        try {
          child.onTrace?.(
            buildSubagentTrace(thread.context.all(), {
              childId,
              label: child.label,
              status,
              ...(child.step ? { step: child.step } : {}),
              startedAt,
              durationMs: Math.max(0, (services.clock ?? Date.now)() - startedAt),
            }),
          )
        } catch (err) {
          logger?.('warn', 'child trace failed', err)
        }
        await thread.shutdown().catch((err) => logger?.('warn', 'child thread shutdown failed', err))
        threads.delete(childId)
      }
    },

    listThreads(listOpts) {
      return services.rollout.list({ ...listOpts, excludeProfiles: UNLISTED_PROFILES })
    },

    searchThreads(query, searchOpts) {
      return services.rollout.search(query, { ...searchOpts, excludeProfiles: UNLISTED_PROFILES })
    },

    async getThread(threadId) {
      const thread = await loadThread(threadId)
      if (!thread) return undefined
      const items: HistoryItem[] = [...thread.context.all()]
      const listed = (await services.rollout.list({ includeArchived: true, limit: 1000 })).find(
        (r) => r.threadId === threadId,
      )
      const record: ThreadRecord = listed ?? {
        threadId,
        origin: thread.origin,
        settings: thread.settings,
        title: thread.settings.title ?? '',
        createdAt: items[0]?.createdAt ?? Date.now(),
        updatedAt: items[items.length - 1]?.createdAt ?? Date.now(),
        pinned: false,
        archived: false,
        itemCount: items.length,
      }
      return {
        record: { ...record, settings: thread.settings, title: thread.settings.title ?? record.title },
        items,
        running: thread.activeTurn !== undefined,
        pendingAsks: pendingAsks.forThread(threadId),
      }
    },

    async postNote(threadId, text) {
      await postAssistantNote(await requireThread(threadId), emitter.emit, text, services.clock ?? Date.now)
    },

    async updateMeta(threadId, patch) {
      await services.rollout.updateMeta(threadId, patch)
      const thread = threads.get(threadId)
      if (thread && patch.title !== undefined && patch.title !== thread.settings.title) {
        thread.updateSettings({ title: patch.title })
        emitter.emit({ type: 'thread.title', threadId, title: patch.title })
      }
    },

    async forkThread(sourceId, { throughItemId, title }) {
      if (closed) throw new Error('kernel is shut down')
      const source = await requireThread(sourceId)
      const picked = forkItems(source.context.all(), throughItemId, source.activeTurn?.turnId)
      if (!picked.ok) throw Object.assign(new Error(`cannot fork ${sourceId}: ${picked.code}`), { code: picked.code })
      const threadId = newThreadId()
      const settings: ThreadSettings = { ...source.settings, title }
      await services.rollout.create({ threadId, origin: source.origin, settings, title })
      if (picked.items.length > 0) {
        await services.rollout.append(
          threadId,
          picked.items.map((item): RolloutLine => ({ ts: item.createdAt, type: 'item', item })),
        )
      }
      await services.rollout.flush(threadId)
      const thread = new Thread(threadDeps(), { threadId, origin: source.origin, settings, title, items: picked.items })
      threads.set(threadId, thread)
      emitter.emit({ type: 'thread.created', threadId, settings, origin: source.origin })
      return threadId
    },

    async removeThread(threadId) {
      const thread = threads.get(threadId)
      if (thread) {
        await thread.shutdown()
        threads.delete(threadId)
      }
      await services.rollout.remove(threadId)
    },

    async shutdown() {
      closed = true
      pendingAsks.dispose()
      const all = [...threads.values()]
      threads.clear()
      await Promise.all(all.map((t) => t.shutdown().catch((err) => logger?.('warn', 'thread shutdown failed', err))))
    },
  }

  return kernel
}
