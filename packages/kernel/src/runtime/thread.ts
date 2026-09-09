/**
 * Thread: owns the ContextManager, settings, origin, mailbox and at most one active turn. Every Op except
 * thread.create lands here. Persistence goes through the RolloutStore as items are recorded; flush() is a
 * barrier awaited before terminal events.
 *
 * Mutating ops (turn.start, compact, rollback, clear, shutdown) are serialised behind a per-thread promise
 * mutex and re-check `closed` / `active` after every await, so two concurrent turn.start ops can never leave
 * two live turns sharing one context, and nothing starts after shutdown. turn.interrupt, approval.resolve and
 * thread.settings bypass the mutex on purpose: they must reach a running turn.
 */
import {
  newItemId,
  newTurnId,
  type HistoryItem,
  type Op,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type UserInput,
  type UserMessageItem,
} from '@aiwc/protocol'
import type { KernelServices, ResumeState, RolloutLine } from '../ports'
import { compactContext } from './compaction'
import { ContextManager, type RecordOptions } from './context/manager'
import { WorldStateTracker, worldStateFromJson, worldStateToJson } from './context/worldState'
import type { Emitter } from './emitter'
import { errorActions, isAbortError } from './model/errors'
import { PromptBuilder } from './prompt'
import { startTurn, type TurnHandle, type TurnResult } from './turn'
import type { KernelConfig, Logger, SystemPromptConfig } from './types'
import { createRwLock } from './util/rwlock'

export interface ThreadDeps {
  services: KernelServices
  config: () => KernelConfig
  systemPrompt: SystemPromptConfig
  emit: Emitter['emit']
  logger?: Logger
  /** 0 = main agent, 1 = subagent (delegate children). */
  depth?: number
  /** Per-thread step cap override (child runs use 12). */
  maxSteps?: number
}

export interface ThreadInit {
  threadId: ThreadId
  origin: ThreadOrigin
  settings: ThreadSettings
  title?: string
  items?: HistoryItem[]
  worldState?: ResumeState['worldState']
}

const TITLE_PROMPT = '根据下面这段对话，给出一个不超过 12 个字的中文标题，概括用户的主要意图。只输出标题本身，不要标点、引号或解释。'

export class Thread {
  readonly id: ThreadId
  readonly origin: ThreadOrigin
  readonly depth: number
  private _settings: ThreadSettings
  readonly context: ContextManager
  private readonly worldState: WorldStateTracker
  private readonly prompt: PromptBuilder
  private readonly lock = createRwLock()
  private active: TurnHandle | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  /** Serialises mutating ops (see file header). Never rejects; each op's own promise carries its error. */
  private opQueue: Promise<void> = Promise.resolve()
  private closed = false
  private titleJob: Promise<void> | undefined
  private titleAbort: AbortController | undefined
  /** First append failure since the last flush(); flush() rethrows it so callers never claim durability. */
  private writeFailure: { err: unknown } | undefined

  constructor(
    private readonly deps: ThreadDeps,
    init: ThreadInit,
  ) {
    this.id = init.threadId
    this.origin = init.origin
    this.depth = deps.depth ?? 0
    this._settings = { ...init.settings, title: init.title ?? init.settings.title }
    this.worldState = new WorldStateTracker(worldStateFromJson(init.worldState))
    this.context = new ContextManager(init.items ?? [], {
      onInvalidate: () => {
        this.worldState.reset()
        // history is gone, so anything a provider decided not to re-send is gone with it
        for (const p of deps.services.fragmentProviders) {
          try {
            p.reset?.(this.id)
          } catch (err) {
            deps.logger?.('warn', 'fragment provider reset failed', err)
          }
        }
      },
    })
    // The stable tier is frozen for the thread's lifetime and `profile` is fixed at creation, so
    // picking the per-profile prompt here (rather than per turn) keeps the prompt cache intact.
    const profile = this._settings.profile
    this.prompt = new PromptBuilder({
      stable: deps.systemPrompt.byProfile?.[profile] ?? deps.systemPrompt.stable,
      skills: deps.services.skills,
      fragmentProviders: deps.services.fragmentProviders,
      includeSkills: !(deps.systemPrompt.skillsExcludedProfiles ?? []).includes(profile),
      onError: (err) => deps.logger?.('warn', 'stable fragment failed', err),
    })
  }

  get settings(): ThreadSettings {
    return this._settings
  }

  get activeTurn(): TurnHandle | undefined {
    return this.active
  }

  get isClosed(): boolean {
    return this.closed
  }

  private get clock(): () => number {
    return this.deps.services.clock ?? Date.now
  }

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(op)
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`thread ${this.id} is shut down`)
  }

  // ---------------------------------------------------------------------------------- persistence

  readonly record = (items: HistoryItem[], opts?: RecordOptions): HistoryItem[] => {
    const recorded = this.context.recordItems(items, opts)
    const ts = this.clock()
    this.persistLines(recorded.map((item): RolloutLine => ({ ts, type: 'item', item })))
    return recorded
  }

  readonly persist = (line: RolloutLine): void => {
    this.persistLines([line])
  }

  private persistLines(lines: RolloutLine[]): void {
    if (lines.length === 0) return
    if (this.closed) {
      // nothing may reach the rollout after shutdown (the kernel may already have removed the file)
      this.deps.logger?.('warn', `dropped ${lines.length} rollout line(s) for closed thread ${this.id}`)
      return
    }
    this.writeQueue = this.writeQueue
      .then(() => this.deps.services.rollout.append(this.id, lines))
      .catch((err) => {
        this.deps.logger?.('error', 'rollout append failed', err)
        this.writeFailure ??= { err }
      })
  }

  /**
   * Durability barrier. Rejects when any append since the previous flush failed, or when the store's own flush
   * fails — callers (turn loop, compact, rollback) turn that into a 'rollout_write_failed' error event instead of
   * claiming the history is on disk.
   */
  readonly flush = async (): Promise<void> => {
    await this.writeQueue
    if (this.writeFailure) {
      const { err } = this.writeFailure
      this.writeFailure = undefined
      throw err
    }
    await this.deps.services.rollout.flush(this.id)
  }

  private emitRolloutError(err: unknown): void {
    const error = { code: 'rollout_write_failed', message: `对话记录写入失败：${err instanceof Error ? err.message : String(err)}`, retryable: true }
    this.deps.emit({ type: 'error', threadId: this.id, error, actions: errorActions(error) })
  }

  /**
   * Rewrites the persisted thread from the in-memory history (rollback / clear). Prefers the store's atomic
   * rewrite(), which keeps thread meta (createdAt, pinned, archived, title) and re-emits the compaction checkpoint.
   * Stores without rewrite() fall back to remove()+create(), restoring what that API allows (pinned, archived,
   * title; createdAt is lost). Failures are surfaced as rollout_write_failed and rethrown to the op caller.
   */
  private async rewritePersisted(): Promise<void> {
    const rollout = this.deps.services.rollout
    const items = [...this.context.all()]
    const settings = this._settings
    const lastCompactedThroughId = this.context.lastCompaction()?.foldedThroughId
    const snapshot = this.worldState.current()
    const worldState = snapshot ? worldStateToJson(snapshot) : undefined
    const rewrite = rollout.rewrite?.bind(rollout)
    const task = rewrite
      ? () => rewrite(this.id, { items, settings, lastCompactedThroughId, worldState })
      : async (): Promise<void> => {
          const existing = (await rollout.list({ includeArchived: true, limit: 1000 })).find((r) => r.threadId === this.id)
          await rollout.remove(this.id)
          await rollout.create({ threadId: this.id, origin: this.origin, settings, title: existing?.title || settings.title })
          if (existing && (existing.pinned || existing.archived)) {
            await rollout.updateMeta(this.id, { pinned: existing.pinned, archived: existing.archived })
          }
          if (items.length > 0) await rollout.append(this.id, items.map((item): RolloutLine => ({ ts: item.createdAt, type: 'item', item })))
        }
    const run = this.writeQueue.then(task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    try {
      await run
      await this.flush()
    } catch (err) {
      this.deps.logger?.('error', 'rollout rewrite failed', err)
      this.emitRolloutError(err)
      throw err
    }
  }

  // ---------------------------------------------------------------------------------- ops

  async submit(op: Op): Promise<void> {
    this.assertOpen()
    switch (op.type) {
      case 'thread.create':
        throw new Error('thread.create is handled by the kernel')
      case 'turn.start':
        await this.startTurn(op.input, op.mode ?? 'start')
        return
      case 'turn.interrupt':
        this.active?.interrupt('interrupted')
        return
      case 'approval.resolve': {
        // The router persists "总是允许" through onAllowAlways (it knows the tool name); here only the event.
        const ok = this.deps.services.approvals.resolve(op.approvalId, op.decision, this.id)
        if (ok) this.deps.emit({ type: 'approval.resolved', threadId: this.id, approvalId: op.approvalId, decision: op.decision })
        return
      }
      case 'thread.settings':
        this.updateSettings(op.patch)
        return
      case 'thread.compact':
        await this.compact()
        return
      case 'thread.rollback':
        await this.rollback(op.turns)
        return
      case 'thread.clear':
        await this.clear()
        return
      case 'thread.shutdown':
        await this.shutdown()
        return
    }
  }

  updateSettings(patch: Partial<ThreadSettings>): void {
    this._settings = { ...this._settings, ...patch }
    this.persist({ ts: this.clock(), type: 'settings', settings: this._settings })
    if (!this.closed) {
      void this.deps.services.rollout.updateMeta(this.id, { settings: this._settings }).catch((err) => this.deps.logger?.('warn', 'updateMeta failed', err))
    }
    this.deps.emit({ type: 'thread.settings', threadId: this.id, settings: this._settings })
  }

  /** Starts (or steers) a turn. Resolves once the turn is running, not when it ends. */
  startTurn(input: UserInput, mode: 'start' | 'steer'): Promise<TurnHandle> {
    return this.serialize(() => this.startTurnLocked(input, mode))
  }

  private async startTurnLocked(input: UserInput, mode: 'start' | 'steer'): Promise<TurnHandle> {
    this.assertOpen()
    const previous = this.active
    if (previous) {
      // A steer is accepted only while the step loop can still consume it; a late steer becomes its own turn.
      if (mode === 'steer' && previous.steer(input)) return previous
      if (mode !== 'steer') previous.interrupt('replaced')
      await previous.promise
      if (this.active === previous) this.active = undefined
      this.assertOpen()
    }
    if (!this._settings.title && !this.context.all().some((item) => item.type === 'user_message')) {
      const title = input.content.map((part) => part.type === 'text' ? part.text : '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 24) || input.mentions[0]?.label || '附件会话'
      await this.deps.services.rollout.updateMeta(this.id, { title })
      this.deps.emit({ type: 'thread.title', threadId: this.id, title })
    }
    const config = this.deps.config()
    const handle = startTurn(
      {
        threadId: this.id,
        origin: this.origin,
        depth: this.depth,
        settings: () => this._settings,
        services: this.deps.services,
        config,
        maxSteps: this.deps.maxSteps ?? config.maxStepsPerTurn,
        emit: this.deps.emit,
        context: this.context,
        record: this.record,
        persist: this.persist,
        flush: this.flush,
        prompt: this.prompt,
        worldState: this.worldState,
        lock: this.lock,
        clock: this.clock,
        onAllowAlways: (toolName) => this.allowAlways(toolName),
        logger: this.deps.logger,
      },
      input,
    )
    this.active = handle
    void handle.promise.then((result) => {
      if (this.active === handle) this.active = undefined
      this.afterTurn(result)
    })
    return handle
  }

  /** "总是允许" answered in an approval popover: remember the tool for this thread. */
  private allowAlways(toolName: string): void {
    if (this.closed || this._settings.allowAlways.includes(toolName)) return
    this.updateSettings({ allowAlways: [...this._settings.allowAlways, toolName] })
  }

  private afterTurn(result: TurnResult): void {
    if (result.status !== 'completed' || this._settings.title || this.depth > 0 || this.titleJob || this.closed) return
    // tied to the thread: shutdown() aborts and awaits it, so nothing reaches the rollout index afterwards
    const controller = new AbortController()
    this.titleAbort = controller
    this.titleJob = this.generateTitle(controller.signal).finally(() => {
      this.titleJob = undefined
      if (this.titleAbort === controller) this.titleAbort = undefined
    })
  }

  private async generateTitle(signal: AbortSignal): Promise<void> {
    try {
      const model = await this.deps.services.models.resolveAuxiliary()
      if (signal.aborted || this.closed) return
      const transcript = this.context
        .all()
        .filter((it) => it.type === 'user_message' || it.type === 'assistant_message')
        .slice(0, 6)
        .map((it) => (it.type === 'user_message' ? `用户：${it.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ')}` : `AI：${it.text}`))
        .join('\n')
        .slice(0, 4000)
      if (!transcript.trim()) return
      const prompt: UserMessageItem = { type: 'user_message', id: newItemId(), turnId: newTurnId(), createdAt: this.clock(), content: [{ type: 'text', text: transcript }], mentions: [] }
      let title = ''
      for await (const part of model.sample({ system: TITLE_PROMPT, history: [prompt], tools: [], toolChoice: 'none', signal, maxOutputTokens: 40 })) {
        if (part.type === 'text.delta') title += part.delta
        if (part.type === 'error') return
        if (part.type === 'finish' && part.reason === 'aborted') return
      }
      title = title.trim().replace(/^["'“”‘’「」]+|["'“”‘’「」。]+$/g, '').slice(0, 24)
      if (!title || this._settings.title || signal.aborted || this.closed) return
      this._settings = { ...this._settings, title }
      this.deps.emit({ type: 'thread.title', threadId: this.id, title })
      await this.deps.services.rollout.updateMeta(this.id, { title })
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return
      this.deps.logger?.('warn', 'title generation failed', err)
    }
  }

  /**
   * Manual compaction. Refused (with an 'error' event, code 'compaction_refused') while a turn is active: the
   * turn loop already compacts on its own and two writers on one context are never allowed.
   */
  compact(): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      if (this.active) {
        const error = { code: 'compaction_refused', message: '当前有正在运行的回合，等它结束后再手动压缩上下文', retryable: true }
        this.deps.emit({ type: 'error', threadId: this.id, error, actions: errorActions(error) })
        return
      }
      try {
        const model = await this.deps.services.models.resolve(this._settings.model)
        const summary = await compactContext(
          { threadId: this.id, context: this.context, contextWindow: model.ref.contextWindow, record: this.record, persist: this.persist, emit: this.deps.emit },
          { models: this.deps.services.models, hooks: this.deps.services.hooks, clock: this.clock, logger: this.deps.logger },
        )
        if (summary) this.worldState.reset()
      } catch (err) {
        const error = { code: 'compaction_failed', message: err instanceof Error ? err.message : String(err), retryable: true }
        this.deps.emit({ type: 'error', threadId: this.id, error, actions: errorActions(error) })
        return
      }
      await this.flush().catch((err) => this.emitRolloutError(err))
    })
  }

  /** Interrupts the active turn (if any) and waits for it to settle. Callers re-check state afterwards. */
  private async settleActive(): Promise<void> {
    const previous = this.active
    if (!previous) return
    previous.interrupt('interrupted')
    await previous.promise
    if (this.active === previous) this.active = undefined
  }

  rollback(turns: number): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      await this.settleActive()
      this.assertOpen()
      this.context.dropLastNUserTurns(turns)
      await this.rewritePersisted()
    })
  }

  clear(): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      await this.settleActive()
      this.assertOpen()
      this.context.clear()
      await this.rewritePersisted()
    })
  }

  shutdown(): Promise<void> {
    return this.serialize(async () => {
      if (this.closed) return
      await this.settleActive()
      this.titleAbort?.abort()
      await this.titleJob?.catch(() => undefined)
      this.deps.services.approvals.cancelAll(this.id)
      await this.flush().catch((err) => {
        this.deps.logger?.('error', 'rollout flush failed during shutdown', err)
        this.emitRolloutError(err)
      })
      this.closed = true
    })
  }
}
