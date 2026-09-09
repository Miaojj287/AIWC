/**
 * Turn loop (ARCHITECTURE §4): UserPromptSubmit → pre-turn compaction → record user message → turn fragments
 * → Steps until the model stops calling tools / step cap / loop guard / timeout / interrupt → Stop hook →
 * turn.completed (or turn_aborted item + flush + turn.aborted).
 *
 * Durability: turn.completed is only emitted after the rollout flush succeeded. A failed append / flush is
 * surfaced as an 'error' event (code 'rollout_write_failed') followed by turn.aborted('error') — the UI must
 * never be told the turn is safely on disk when it is not.
 */
import {
  estimateTokens,
  newItemId,
  newStepId,
  newTurnId,
  type ContextFragment,
  type ContextUsage,
  type Event,
  type HistoryItem,
  type Mention,
  type ModelClient,
  type ModelError,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type TokenUsage,
  type TurnAbortedItem,
  type TurnId,
  type UserInput,
  type UserMessageItem,
} from '@aiwc/protocol'
import type { KernelServices, RolloutLine, ToolRouter } from '../ports'
import { compactContext, shouldCompact } from './compaction'
import { createFragment, fragmentToItem, renderFragment } from './context/fragments/base'
import { observedContextFragment } from './context/fragments/observedContext'
import type { ContextManager, RecordOptions } from './context/manager'
import { snapshotWorldState, worldStateToJson, type WorldStateTracker } from './context/worldState'
import type { Emitter } from './emitter'
import { LoopGuard } from './loopGuard'
import { errorActions, isAbortError } from './model/errors'
import type { PromptBuilder } from './prompt'
import { freezeStepContext, runStep } from './step'
import type { KernelConfig, Logger } from './types'
import { deferred } from './util/deferred'
import { fnv1a64 } from './util/hash'
import type { RwLock } from './util/rwlock'

export type AbortReason = TurnAbortedItem['reason']

export interface TurnDeps {
  threadId: ThreadId
  origin: ThreadOrigin
  depth: number
  settings: () => ThreadSettings
  services: KernelServices
  config: KernelConfig
  maxSteps: number
  emit: Emitter['emit']
  context: ContextManager
  record: (items: HistoryItem[], opts?: RecordOptions) => HistoryItem[]
  persist: (line: RolloutLine) => void
  flush: () => Promise<void>
  prompt: PromptBuilder
  worldState: WorldStateTracker
  lock: RwLock
  clock: () => number
  /** The user answered an approval with "总是允许": the Thread persists the tool into ThreadSettings.allowAlways. */
  onAllowAlways?: (toolName: string) => void
  logger?: Logger
}

export type TurnResult =
  | { status: 'completed'; turnId: TurnId; text: string; usage: TokenUsage; steps: number }
  | { status: 'aborted'; turnId: TurnId; reason: AbortReason; text: string }

export interface TurnHandle {
  readonly turnId: TurnId
  readonly promise: Promise<TurnResult>
  /**
   * Merge more user input into the running turn; it is consumed before the next step. Returns false once the
   * step loop can no longer pick it up (finishing, aborting or done) — the caller must then start a new turn.
   */
  steer(input: UserInput): boolean
  interrupt(reason?: 'interrupted' | 'replaced'): void
}

const sumUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) || undefined,
  reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined,
})

export const inputText = (input: UserInput): string => input.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')

/** Ops arrive over IPC unvalidated; a malformed UserInput must not crash the turn. */
const normalizeInput = (input: UserInput): UserInput => ({
  content: Array.isArray(input.content) ? input.content : [],
  mentions: Array.isArray(input.mentions) ? input.mentions : [],
})

export function startTurn(deps: TurnDeps, input: UserInput): TurnHandle {
  const turnId = newTurnId()
  const controller = new AbortController()
  const mailbox: UserInput[] = [normalizeInput(input)]
  let abortReason: AbortReason | undefined
  /** Set once the step loop can no longer consume the mailbox (completing, aborting or crashed). */
  let loopDone = false
  /** Set once a terminal event (turn.completed / turn.aborted) has been emitted. */
  let terminal = false
  const done = deferred<TurnResult>()
  // Cleared on every terminal path (completed / aborted / error / interrupted / crash) via settle() below.
  const timer = setTimeout(() => abort('timeout'), deps.config.turnTimeoutMs)
  ;(timer as { unref?: () => void }).unref?.()
  const clearTimer = (): void => clearTimeout(timer)

  const abort = (reason: AbortReason): void => {
    if (controller.signal.aborted) return
    abortReason = reason
    controller.abort()
  }

  const safeEmit = (event: Event): void => {
    try {
      deps.emit(event)
    } catch (err) {
      deps.logger?.('warn', 'emit failed', err)
    }
  }

  /** Best-effort terminal path for an unexpected throw inside run(): the UI must never be left "generating". */
  const crashed = async (err: unknown): Promise<TurnResult> => {
    loopDone = true
    clearTimer()
    deps.logger?.('error', 'turn crashed', err)
    if (!terminal) {
      try {
        deps.record([{ type: 'turn_aborted', id: newItemId(), turnId, createdAt: deps.clock(), reason: 'error' }])
      } catch (recordErr) {
        deps.logger?.('error', 'record turn_aborted failed', recordErr)
      }
    }
    await deps.flush().catch((flushErr) => {
      deps.logger?.('error', 'flush after crash failed', flushErr)
      const error = { code: 'rollout_write_failed', message: `对话记录写入失败：${flushErr instanceof Error ? flushErr.message : String(flushErr)}`, retryable: true }
      safeEmit({ type: 'error', threadId: deps.threadId, turnId, error, actions: errorActions(error) })
    })
    if (!terminal) {
      terminal = true
      const error = { code: 'internal', message: err instanceof Error ? err.message : String(err), retryable: true }
      safeEmit({ type: 'error', threadId: deps.threadId, turnId, error, actions: errorActions(error) })
      safeEmit({ type: 'turn.aborted', threadId: deps.threadId, turnId, reason: 'error' })
    }
    return { status: 'aborted', turnId, reason: 'error', text: '' }
  }

  const settle = (result: TurnResult): void => {
    clearTimer()
    done.resolve(result)
  }
  void run().then(settle, (err) => crashed(err).then(settle))

  return {
    turnId,
    promise: done.promise,
    steer(more) {
      if (loopDone || done.settled || controller.signal.aborted) return false
      mailbox.push(normalizeInput(more))
      return true
    },
    interrupt(reason = 'interrupted') {
      abort(reason)
    },
  }

  async function run(): Promise<TurnResult> {
    const { threadId, emit, services } = deps
    const clock = deps.clock
    emit({ type: 'turn.started', threadId, turnId, at: clock() })
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let finalText = ''
    let steps = 0
    /** True once the turn's own input is in history; steers accepted afterwards are the user's words too. */
    let inputRecorded = false
    const mentions: Mention[] = []
    const guard = new LoopGuard()

    const emitError = (error: ModelError | { code: string; message: string; retryable?: boolean }): void => {
      emit({ type: 'error', threadId, turnId, error, actions: errorActions(error) })
    }
    /** Flush barrier; a failure is reported as rollout_write_failed and returned (never thrown). */
    const flushDurable = async (): Promise<boolean> => {
      try {
        await deps.flush()
        return true
      } catch (err) {
        deps.logger?.('error', 'rollout flush failed', err)
        emitError({ code: 'rollout_write_failed', message: `对话记录写入失败：${err instanceof Error ? err.message : String(err)}`, retryable: true })
        return false
      }
    }
    const finishAborted = async (reason: AbortReason): Promise<TurnResult> => {
      loopDone = true
      clearTimer()
      if (inputRecorded) drainMailbox()
      const item: TurnAbortedItem = { type: 'turn_aborted', id: newItemId(), turnId, createdAt: clock(), reason }
      deps.record([item])
      await services.hooks.run('TurnAborted', { threadId, turnId }).catch(() => undefined)
      await flushDurable()
      terminal = true
      emit({ type: 'turn.aborted', threadId, turnId, reason })
      return { status: 'aborted', turnId, reason, text: finalText }
    }
    const drainMailbox = (): void => {
      while (mailbox.length > 0) {
        const next = mailbox.shift()!
        const item: UserMessageItem = { type: 'user_message', id: newItemId(), turnId, createdAt: clock(), content: next.content, mentions: next.mentions }
        deps.record([item])
        mentions.push(...next.mentions)
        emit({ type: 'item.user', threadId, turnId, itemId: item.id, content: item.content, mentions: item.mentions })
      }
    }
    const recordFragment = (fragment: ContextFragment): void => {
      try {
        const item = fragmentToItem(fragment, turnId, clock())
        if (item) deps.record([item])
      } catch (err) {
        deps.logger?.('warn', `fragment ${fragment.kind} rejected`, err)
      }
    }
    const resolveModel = async (): Promise<ModelClient | undefined> => {
      try {
        return await services.models.resolve(deps.settings().model)
      } catch (err) {
        emitError({ code: 'auth', message: err instanceof Error ? err.message : String(err), retryable: false })
        return undefined
      }
    }
    const buildRouter = (settings: ThreadSettings): ToolRouter =>
      services.tools.build({
        profile: settings.profile,
        depth: deps.depth,
        deny: [],
        permissionMode: () => deps.settings().permissionMode,
        allowAlways: () => deps.settings().allowAlways,
        onAllowAlways: deps.onAllowAlways,
      })
    const computeUsage = (systemTokens: number, router: ToolRouter, model: ModelClient): ContextUsage =>
      deps.context.usage({ systemTokens, toolSpecTokens: estimateTokens(JSON.stringify(router.specs)), maxTokens: model.ref.contextWindow })
    const maybeCompact = async (usage: ContextUsage, model: ModelClient): Promise<void> => {
      if (!shouldCompact(usage, deps.config.compactionThreshold)) return
      try {
        const summary = await compactContext(
          { threadId, context: deps.context, contextWindow: model.ref.contextWindow, record: deps.record, persist: deps.persist, emit, signal: controller.signal },
          { models: services.models, hooks: services.hooks, clock, logger: deps.logger },
        )
        if (summary) deps.worldState.reset()
      } catch (err) {
        // an interrupt that lands mid-compaction is an interruption, not a compaction failure
        if (controller.signal.aborted || isAbortError(err)) {
          deps.logger?.('debug', 'compaction interrupted', err)
          return
        }
        deps.logger?.('warn', 'compaction failed', err)
        emitError({ code: 'compaction_failed', message: err instanceof Error ? err.message : String(err), retryable: true })
      }
    }

    // 1. UserPromptSubmit hook
    const firstText = inputText(mailbox[0]!)
    let hookContext: string | undefined
    try {
      const hook = await services.hooks.run('UserPromptSubmit', { threadId, turnId, text: firstText })
      if (hook.block) {
        emitError({ code: 'hook_blocked', message: hook.block.reason, retryable: false })
        return finishAborted('error')
      }
      hookContext = hook.additionalContext
    } catch (err) {
      deps.logger?.('warn', 'UserPromptSubmit hook failed', err)
    }

    // 2. pre-turn compaction check
    let settings = deps.settings()
    let model = await resolveModel()
    if (!model) return finishAborted('error')
    let router = buildRouter(settings)
    deps.persist({ ts: clock(), type: 'turn_context', turnId, modelId: model.ref.modelId, profile: settings.profile, permissionMode: settings.permissionMode })
    {
      const stable = await deps.prompt.stablePrompt({ threadId, origin: deps.origin, settings })
      await maybeCompact(computeUsage(stable.tokens, router, model), model)
    }

    // 3. record user message(s) + turn-tier fragments
    drainMailbox()
    inputRecorded = true
    if (hookContext) recordFragment(createFragment('hook_context', '<hook_context>', 2000, () => hookContext!))
    // AGENTS rules are re-provided every turn for freshness but recorded only when the model has not seen this
    // exact text: the world-state baseline remembers a digest of the last recorded text (see step loop).
    let userInstructions: ContextFragment | undefined
    let userInstructionsDigest = ''
    for (const provider of services.fragmentProviders) {
      if (provider.tier !== 'turn') continue
      try {
        const fragments = await provider.provide({ threadId, origin: deps.origin, settings, userText: firstText })
        for (const f of fragments) {
          if (f.kind === 'user_instructions') {
            userInstructions = f
            userInstructionsDigest = digestFragment(f)
            continue
          }
          const wrapped = f.kind === 'observed_context' && f.marker !== '<observed_context>' ? observedContextFragment(f) : f
          recordFragment(wrapped)
        }
      } catch (err) {
        deps.logger?.('warn', 'fragment provider failed', err)
      }
    }

    // 4. step loop
    while (true) {
      if (controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')
      drainMailbox()
      if (steps >= deps.maxSteps) return finishAborted('step_cap')
      settings = deps.settings()
      const resolved = await resolveModel()
      if (!resolved) return finishAborted('error')
      model = resolved
      router = buildRouter(settings)

      // (re-)inject the rules only when the digest the model last saw differs (also after compaction resets).
      if (userInstructions && deps.worldState.current()?.userInstructions !== userInstructionsDigest) recordFragment(userInstructions)
      const diff = deps.worldState.diff(
        snapshotWorldState({
          permissionMode: settings.permissionMode,
          modelId: model.ref.modelId,
          toolNames: router.specs.map((s) => s.name),
          userInstructions: userInstructionsDigest,
          profile: settings.profile,
        }),
      )
      if (diff) {
        recordFragment(diff.fragment)
        deps.persist({ ts: clock(), type: 'world_state', snapshot: worldStateToJson(deps.worldState.current()!) })
      }

      // usageBefore (the 上下文占用 line inside the prompt) and usageAfter (context.usage event) share the same
      // system-token base — the frozen stable tier — so the two numbers never disagree within one step.
      const stable = await deps.prompt.stablePrompt({ threadId, origin: deps.origin, settings })
      const usageBefore = computeUsage(stable.tokens, router, model)
      const prompt = await deps.prompt.build({ threadId, origin: deps.origin, settings, userText: firstText, mentions, date: new Date(clock()), usage: usageBefore })
      const stepCtx = freezeStepContext({ stepId: newStepId(), index: steps, model, router, settings, systemPrompt: prompt.system, cacheKey: prompt.cacheKey })
      const outcome = await runStep(stepCtx, {
        threadId,
        turnId,
        origin: deps.origin,
        depth: deps.depth,
        emit,
        context: deps.context,
        record: deps.record,
        signal: controller.signal,
        clock,
        lock: deps.lock,
        // loop guard runs BEFORE dispatch: a repeated batch is refused, never executed
        beforeDispatch: (calls) => guard.push(calls.map((c) => ({ toolName: c.toolName, input: c.input }))),
        logger: deps.logger,
      })
      steps++
      totalUsage = sumUsage(totalUsage, outcome.usage)
      if (outcome.text) finalText = outcome.text

      if (outcome.error) {
        emitError(outcome.error)
        return finishAborted('error')
      }
      if (outcome.aborted || controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')

      const usageAfter = computeUsage(prompt.stableTokens, router, model)
      emit({ type: 'context.usage', threadId, usage: usageAfter })

      if (outcome.loopGuard) return finishAborted('loop_guard')
      if (outcome.toolCalls.length === 0) {
        if (mailbox.length > 0) continue
        break
      }
      await maybeCompact(usageAfter, model)
      if (controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')
    }

    // 5. completed — from here on steer() refuses input (the Thread starts a new turn instead)
    loopDone = true
    clearTimer()
    await services.hooks.run('Stop', { threadId, turnId, text: finalText }).catch((err) => deps.logger?.('warn', 'Stop hook failed', err))
    if (!(await flushDurable())) {
      // the model finished but the history is not durable: never claim completion
      terminal = true
      emit({ type: 'turn.aborted', threadId, turnId, reason: 'error' })
      return { status: 'aborted', turnId, reason: 'error', text: finalText }
    }
    terminal = true
    emit({ type: 'turn.completed', threadId, turnId, finalText, usage: totalUsage, steps, at: clock() })
    return { status: 'completed', turnId, text: finalText, usage: totalUsage, steps }
  }

  /** Digest of the fragment exactly as it would be recorded (after the cap), '' when it cannot be rendered. */
  function digestFragment(fragment: ContextFragment): string {
    try {
      return fnv1a64(renderFragment(fragment).text)
    } catch (err) {
      deps.logger?.('warn', `fragment ${fragment.kind} rejected`, err)
      return ''
    }
  }
}
