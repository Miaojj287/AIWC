/**
 * In-memory fakes of the kernel ports (ports.ts) for runtime tests. No I/O, no timers beyond what a test
 * tool deliberately awaits.
 */
import {
  asThreadId,
  type ApprovalDecision,
  type ContextFragment,
  type Event,
  type HistoryItem,
  type ItemId,
  type JsonValue,
  type ModelClient,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type ToolResult,
  type ToolRisk,
} from '@aiwc/protocol'
import type {
  ApprovalGate,
  FragmentProvider,
  Hook,
  HookEventName,
  HookPayload,
  HookResult,
  HookRunner,
  KernelServices,
  ModelResolver,
  ResumeState,
  RolloutLine,
  RolloutStore,
  SkillIndex,
  SkillMeta,
  ThreadRecord,
  ToolDispatchContext,
  ToolDispatchOutcome,
  ToolRouter,
  ToolRouterFactory,
} from '../../ports'
import { createFragment } from '../context/fragments/base'

// ------------------------------------------------------------------------------------------ tools

export interface FakeTool {
  name: string
  risk?: ToolRisk
  parallelSafe?: boolean
  execute: (input: unknown, ctx: { signal: AbortSignal; callId: string }) => Promise<ToolResult> | ToolResult
}

export interface FakeRouterFactory extends ToolRouterFactory {
  builds: Array<{ profile: string; depth: number }>
  /** dispatch order as observed by the router (start order) */
  dispatchLog: string[]
}

export function createFakeRouterFactory(tools: FakeTool[]): FakeRouterFactory {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const factory: FakeRouterFactory = {
    builds: [],
    dispatchLog: [],
    build(opts) {
      factory.builds.push({ profile: opts.profile, depth: opts.depth })
      const visible = tools.filter((t) => !opts.deny?.includes(t.name))
      const router: ToolRouter = {
        specs: visible.map((t) => ({ name: t.name, description: `fake ${t.name}`, inputJsonSchema: { type: 'object' } })),
        has: (name) => byName.has(name),
        risk: (name) => byName.get(name)?.risk ?? 'read',
        parallelSafe: (name) => byName.get(name)?.parallelSafe ?? false,
        summarize: (name, input) => `${name}(${JSON.stringify(input)})`,
        async dispatch(call, ctx: ToolDispatchContext): Promise<ToolDispatchOutcome> {
          const started = Date.now()
          factory.dispatchLog.push(call.toolName)
          const base = {
            type: 'tool.call' as const,
            threadId: ctx.threadId,
            turnId: ctx.turnId,
            stepId: ctx.stepId,
            callId: call.callId,
            toolName: call.toolName,
            summary: router.summarize(call.toolName, call.input),
            input: (call.input ?? null) as JsonValue,
            risk: router.risk(call.toolName) ?? 'read',
            startedAt: started,
          }
          const tool = byName.get(call.toolName)
          if (!tool) {
            const result: ToolResult = { content: `unknown tool ${call.toolName}`, isError: true }
            ctx.emit({ ...base, status: 'error', output: result.content, isError: true, durationMs: 0 })
            return { callId: call.callId, toolName: call.toolName, result, isError: true, status: 'error', durationMs: 0 }
          }
          ctx.emit({ ...base, status: 'running' })
          try {
            const result = await tool.execute(call.input, { signal: ctx.signal, callId: call.callId })
            const durationMs = Date.now() - started
            ctx.emit({ ...base, status: result.isError ? 'error' : 'done', output: result.content, isError: !!result.isError, durationMs, artifacts: result.artifacts })
            return { callId: call.callId, toolName: call.toolName, result, isError: !!result.isError, status: result.isError ? 'error' : 'done', durationMs, artifacts: result.artifacts }
          } catch (err) {
            const durationMs = Date.now() - started
            const result: ToolResult = { content: err instanceof Error ? err.message : String(err), isError: true }
            ctx.emit({ ...base, status: 'error', output: result.content, isError: true, durationMs })
            return { callId: call.callId, toolName: call.toolName, result, isError: true, status: 'error', durationMs }
          }
        },
      }
      return router
    },
  }
  return factory
}

// ------------------------------------------------------------------------------------------ approvals

export function createFakeApprovalGate(): ApprovalGate & { cancelled: ThreadId[] } {
  return {
    cancelled: [],
    decide: () => 'approved',
    ask: async () => 'allow_once' as ApprovalDecision,
    resolve: () => true,
    cancelAll(threadId) {
      this.cancelled.push(threadId)
    },
  }
}

// ------------------------------------------------------------------------------------------ hooks

export interface FakeHookRunner extends HookRunner {
  calls: Array<{ event: HookEventName; payload: HookPayload }>
}

export function createFakeHookRunner(): FakeHookRunner {
  const hooks = new Set<Hook>()
  const runner: FakeHookRunner = {
    calls: [],
    add(hook) {
      hooks.add(hook)
      return () => {
        hooks.delete(hook)
      }
    },
    async run(event, payload) {
      runner.calls.push({ event, payload })
      let merged: HookResult = {}
      for (const h of hooks) {
        if (!h.events.includes(event)) continue
        const r = await h.run(event, payload)
        if (r) merged = { ...merged, ...r }
      }
      return merged
    },
  }
  return runner
}

// ------------------------------------------------------------------------------------------ rollout

interface StoredThread {
  meta: { threadId: ThreadId; origin: ThreadOrigin; settings: ThreadSettings; title: string; createdAt: number; pinned: boolean; archived: boolean }
  lines: RolloutLine[]
}

export interface MemoryRolloutStore extends RolloutStore {
  /** chronological log of store operations, e.g. 'append:3', 'flush' */
  log: string[]
  threads: Map<ThreadId, StoredThread>
  linesOf(threadId: ThreadId): RolloutLine[]
  itemsOf(threadId: ThreadId): HistoryItem[]
}

/** `rewrite: true` adds the optional RolloutStore.rewrite() (atomic replace keeping meta + checkpoint). */
export function createMemoryRolloutStore(opts: { rewrite?: boolean } = {}): MemoryRolloutStore {
  const threads = new Map<ThreadId, StoredThread>()
  const store: MemoryRolloutStore = {
    log: [],
    threads,
    linesOf: (id) => threads.get(id)?.lines ?? [],
    itemsOf: (id) => (threads.get(id)?.lines ?? []).flatMap((l) => (l.type === 'item' ? [l.item] : [])),
    async create(meta) {
      threads.set(meta.threadId, {
        meta: { ...meta, title: meta.title ?? meta.settings.title ?? '', createdAt: Date.now(), pinned: false, archived: false },
        lines: [{ ts: Date.now(), type: 'thread_meta', threadId: meta.threadId, origin: meta.origin, settings: meta.settings, title: meta.title }],
      })
      store.log.push('create')
    },
    async append(threadId, lines) {
      const t = threads.get(threadId)
      if (!t) throw new Error(`no thread ${threadId}`)
      t.lines.push(...lines)
      store.log.push(`append:${lines.map((l) => (l.type === 'item' ? l.item.type : l.type)).join(',')}`)
    },
    async flush() {
      store.log.push('flush')
    },
    async resume(threadId): Promise<ResumeState | undefined> {
      const t = threads.get(threadId)
      if (!t) return undefined
      let settings = t.meta.settings
      let lastCompactedThroughId: ItemId | undefined
      let worldState: Record<string, JsonValue> | undefined
      const items: HistoryItem[] = []
      for (const line of t.lines) {
        if (line.type === 'item') items.push(line.item)
        else if (line.type === 'settings') settings = line.settings
        else if (line.type === 'compacted') lastCompactedThroughId = line.foldedThroughId
        else if (line.type === 'world_state') worldState = line.snapshot
      }
      return { items, settings, origin: t.meta.origin, title: t.meta.title, lastCompactedThroughId, worldState }
    },
    async list(opts) {
      const out: ThreadRecord[] = []
      for (const t of threads.values()) {
        if (opts?.channel && t.meta.origin.channel !== opts.channel) continue
        if (t.meta.archived && !opts?.includeArchived) continue
        if (opts?.query && !t.meta.title.includes(opts.query)) continue
        const items = store.itemsOf(t.meta.threadId)
        out.push({
          threadId: t.meta.threadId,
          origin: t.meta.origin,
          settings: t.meta.settings,
          title: t.meta.title,
          createdAt: t.meta.createdAt,
          updatedAt: items[items.length - 1]?.createdAt ?? t.meta.createdAt,
          pinned: t.meta.pinned,
          archived: t.meta.archived,
          itemCount: items.length,
        })
      }
      return out.slice(0, opts?.limit ?? out.length)
    },
    async updateMeta(threadId, patch) {
      const t = threads.get(threadId)
      if (!t) return
      if (patch.title !== undefined) t.meta.title = patch.title
      if (patch.pinned !== undefined) t.meta.pinned = patch.pinned
      if (patch.archived !== undefined) t.meta.archived = patch.archived
      if (patch.settings) t.meta.settings = patch.settings
      store.log.push('updateMeta')
    },
    async remove(threadId) {
      threads.delete(threadId)
      store.log.push('remove')
    },
    async search() {
      return []
    },
  }
  if (opts.rewrite) {
    store.rewrite = async (threadId, state) => {
      const t = threads.get(threadId)
      if (!t) throw new Error(`no thread ${threadId}`)
      const ts = Date.now()
      const lines: RolloutLine[] = [{ ts: t.meta.createdAt, type: 'thread_meta', threadId, origin: t.meta.origin, settings: state.settings, title: t.meta.title || undefined }]
      if (state.lastCompactedThroughId) {
        const summary = state.items.find((i) => i.type === 'compaction_summary' && i.foldedThroughId === state.lastCompactedThroughId)
        if (summary) lines.push({ ts, type: 'compacted', summaryItemId: summary.id, foldedThroughId: state.lastCompactedThroughId })
      }
      for (const item of state.items) lines.push({ ts, type: 'item', item })
      if (state.worldState) lines.push({ ts, type: 'world_state', snapshot: state.worldState })
      t.lines = lines
      t.meta.settings = state.settings
      store.log.push('rewrite')
    }
  }
  return store
}

// ------------------------------------------------------------------------------------------ skills / models

export function createFakeSkillIndex(skills: SkillMeta[] = []): SkillIndex {
  return {
    async refresh() {},
    list: () => skills,
    get: (name) => skills.find((s) => s.name === name),
    async read(name) {
      return `# ${name}`
    },
    indexFragment: () =>
      createFragment('skills_index', '<skills>', 800, () => (skills.length ? skills.map((s) => `- ${s.name}：${s.description}`).join('\n') : '')),
  }
}

export function createFakeModelResolver(main: ModelClient, auxiliary: ModelClient = main): ModelResolver & { resolutions: number } {
  return {
    resolutions: 0,
    async resolve() {
      this.resolutions++
      return main
    },
    async resolveAuxiliary() {
      return auxiliary
    },
  }
}

export function staticFragmentProvider(tier: 'stable' | 'turn', fragments: ContextFragment[]): FragmentProvider {
  return { tier, provide: async () => fragments }
}

// ------------------------------------------------------------------------------------------ bundles

export interface TestServices extends KernelServices {
  tools: FakeRouterFactory
  hooks: FakeHookRunner
  rollout: MemoryRolloutStore
  models: ModelResolver & { resolutions: number }
}

export function createTestServices(input: {
  model: ModelClient
  auxiliary?: ModelClient
  tools?: FakeTool[]
  fragmentProviders?: FragmentProvider[]
  clock?: () => number
  /** give the in-memory store the optional rewrite() port method */
  rolloutRewrite?: boolean
}): TestServices {
  return {
    tools: createFakeRouterFactory(input.tools ?? []),
    approvals: createFakeApprovalGate(),
    hooks: createFakeHookRunner(),
    rollout: createMemoryRolloutStore({ rewrite: input.rolloutRewrite }),
    skills: createFakeSkillIndex(),
    models: createFakeModelResolver(input.model, input.auxiliary),
    fragmentProviders: input.fragmentProviders ?? [],
    clock: input.clock,
  }
}

export const testOrigin = (): ThreadOrigin => ({ channel: 'desktop' })
export const testSettings = (patch?: Partial<ThreadSettings>): ThreadSettings => ({ permissionMode: 'bypass', profile: 'desktop-chat', allowAlways: [], ...patch })
export const testThreadId = (s = 'thr_test'): ThreadId => asThreadId(s)

/** Collects emitted events; `types()` gives the compact sequence used by ordering assertions. */
export function collectEvents(on: (l: (e: Event) => void) => () => void): { events: Event[]; types: () => string[]; stop: () => void } {
  const events: Event[] = []
  const stop = on((e) => {
    events.push(e)
  })
  return { events, types: () => events.map((e) => e.type), stop }
}

/** Resolves when an event of the given type is emitted (or rejects after timeoutMs). */
export function waitForEvent<T extends Event['type']>(on: (l: (e: Event) => void) => () => void, type: T, timeoutMs = 5000): Promise<Extract<Event, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timeout waiting for ${type}`))
    }, timeoutMs)
    const off = on((e) => {
      if (e.type === type) {
        clearTimeout(timer)
        off()
        resolve(e as Extract<Event, { type: T }>)
      }
    })
  })
}
