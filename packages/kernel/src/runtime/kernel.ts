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
import type { ThreadRecord } from '../ports'
import { createEmitter } from './emitter'
import { Thread, type ThreadDeps } from './thread'
import type { ChildRunOptions, KernelInternal, KernelOptions } from './types'

export function profileForChannel(channel: ChannelKind): ToolProfile {
  switch (channel) {
    case 'desktop':
      return 'desktop-chat'
    case 'cron':
      return 'cron'
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
export const isGroupOrigin = (origin: ThreadOrigin): boolean => !!origin.chatId && !!origin.peerId && origin.peerId !== origin.chatId

export const sameBotOrigin = (a: ThreadOrigin, b: ThreadOrigin): boolean => {
  if (a.channel !== b.channel || !a.chatId || a.chatId !== b.chatId) return false
  return isGroupOrigin(b) ? a.peerId === b.peerId : !isGroupOrigin(a)
}

const botThreadKey = (origin: ThreadOrigin): string =>
  isGroupOrigin(origin) ? `${origin.channel}:${origin.chatId}:${origin.peerId}` : `${origin.channel}:${origin.chatId}`

export function createKernel(opts: KernelOptions): KernelInternal {
  const { services } = opts
  const logger = opts.logger
  const emitter = createEmitter((err) => logger?.('warn', 'event listener threw', err))
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
      allowAlways: [...config.allowAlways],
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

  const createThread = async (threadId: ThreadId, origin: ThreadOrigin, settings: ThreadSettings, extra?: Pick<ThreadDeps, 'depth' | 'maxSteps'>): Promise<Thread> => {
    if (threads.has(threadId)) throw new Error(`thread already exists: ${threadId}`)
    await services.rollout.create({ threadId, origin, settings, title: settings.title })
    const thread = new Thread(threadDeps(extra), { threadId, origin, settings })
    threads.set(threadId, thread)
    emitter.emit({ type: 'thread.created', threadId, settings, origin })
    return thread
  }

  const runToCompletion = async (thread: Thread, input: UserInput, signal?: AbortSignal): Promise<{ text: string; artifacts: ToolArtifact[] }> => {
    const artifacts: ToolArtifact[] = []
    const off = emitter.on((e: Event) => {
      if (e.type === 'tool.call' && e.threadId === thread.id && e.status === 'done' && e.artifacts?.length) artifacts.push(...e.artifacts)
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
      const thread = await requireThread(op.threadId)
      await thread.submit(op)
      if (op.type === 'thread.shutdown') threads.delete(op.threadId)
    },

    async ensureThread(origin, settings, threadId) {
      if (threadId) {
        const loaded = await loadThread(threadId)
        if (loaded) return loaded.id
      }
      const create = async (): Promise<ThreadId> => (await createThread(threadId ?? newThreadId(), origin, defaultSettings(origin, settings))).id
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
        const records = await services.rollout.list({ channel: origin.channel, limit: 500 })
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
      const childId = newThreadId()
      const settings: ThreadSettings = { permissionMode: 'bypass', profile: 'subagent', allowAlways: [], title: child.label }
      const thread = await createThread(childId, child.origin, settings, { depth: child.depth, maxSteps: child.maxSteps })
      emitter.emit({ type: 'subagent', threadId: child.parentThreadId, childId, status: 'started', label: child.label })
      try {
        const result = await runToCompletion(thread, child.input, child.signal)
        emitter.emit({ type: 'subagent', threadId: child.parentThreadId, childId, status: 'done', label: child.label })
        return result
      } catch (err) {
        emitter.emit({ type: 'subagent', threadId: child.parentThreadId, childId, status: 'failed', label: child.label })
        throw err
      } finally {
        await thread.shutdown().catch(() => undefined)
        threads.delete(childId)
        await services.rollout.remove(childId).catch((err) => logger?.('warn', 'child rollout cleanup failed', err))
      }
    },

    listThreads(listOpts) {
      return services.rollout.list(listOpts)
    },

    async getThread(threadId) {
      const thread = await loadThread(threadId)
      if (!thread) return undefined
      const items: HistoryItem[] = [...thread.context.all()]
      const listed = (await services.rollout.list({ includeArchived: true, limit: 1000 })).find((r) => r.threadId === threadId)
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
      return { record: { ...record, settings: thread.settings, title: thread.settings.title ?? record.title }, items }
    },

    async updateMeta(threadId, patch) {
      await services.rollout.updateMeta(threadId, patch)
      const thread = threads.get(threadId)
      if (thread && patch.title !== undefined && patch.title !== thread.settings.title) {
        thread.updateSettings({ title: patch.title })
        emitter.emit({ type: 'thread.title', threadId, title: patch.title })
      }
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
      const all = [...threads.values()]
      threads.clear()
      await Promise.all(all.map((t) => t.shutdown().catch((err) => logger?.('warn', 'thread shutdown failed', err))))
    },
  }

  return kernel
}
