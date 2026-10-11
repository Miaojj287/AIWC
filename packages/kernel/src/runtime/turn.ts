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
  type GrantScope,
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
import { effectiveAllowAlways } from './effectiveAllowAlways'
import { skillInvocationFragment } from './skillInvocation'
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
import { continuationFragment, judgeStepEnd, MAX_LENGTH_CONTINUATIONS } from './stepEnd'
import { createTurnBudget } from './turnBudget'
import { recordTurnChecks } from './turnChecks'
import type { KernelConfig, Logger } from './types'
import { deferred } from './util/deferred'
import { fnv1a64 } from './util/hash'
import type { RwLock } from './util/rwlock'

export type AbortReason = TurnAbortedItem['reason']

/**
 * Times a blocking Stop hook may send the model back to rewrite its answer in one turn (e.g. a citation audit that
 * found a quote missing from its message). Each rewrite is audited again; after the last one the turn ends as is.
 */
export const MAX_STOP_CONTINUATIONS = 2
export const STOP_HOOK_TOKEN_CAP = 2000

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
  /** The user answered an approval with "总是允许": the Thread persists the key for this thread or globally. */
  onAllowAlways?: (key: string, scope: GrantScope) => void
  /** Grants that apply to every desktop thread (设置 › 权限规则), read per call so a revoke applies at once. */
  globalAllowAlways?: () => readonly string[]
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
  steer(input: UserInput, clientInputId?: string): boolean
  interrupt(reason?: 'interrupted' | 'replaced'): void
}

const sumUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) || undefined,
  reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined,
})

export const inputText = (input: UserInput): string =>
  input.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')

/** Input waiting to be recorded, with the sender's id echoed back on its item.user. */
type MailboxEntry = UserInput & { clientInputId?: string }

/** Ops arrive over IPC unvalidated; a malformed UserInput must not crash the turn. */
const normalizeInput = (input: UserInput, clientInputId?: string): MailboxEntry => ({
  content: Array.isArray(input.content) ? input.content : [],
  mentions: Array.isArray(input.mentions) ? input.mentions : [],
  ...(clientInputId ? { clientInputId } : {}),
})

export function startTurn(deps: TurnDeps, input: UserInput, clientInputId?: string): TurnHandle {
  const turnId = newTurnId()
  const controller = new AbortController()
  const mailbox: MailboxEntry[] = [normalizeInput(input, clientInputId)]
  let abortReason: AbortReason | undefined
  /** Set once the step loop can no longer consume the mailbox (completing, aborting or crashed). */
  let loopDone = false
  /** Set once a terminal event (turn.completed / turn.aborted) has been emitted. */
  let terminal = false
  const done = deferred<TurnResult>()
  // Disposed on every terminal path (completed / aborted / error / interrupted / crash) via settle() below. Time
  // spent waiting for an approval does not count (turnBudget.ts).
  const budget = createTurnBudget(deps.config.turnTimeoutMs, () => abort('timeout'))
  const clearTimer = (): void => budget.dispose()

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
    const dropped = takeUnrecorded()
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
      const error = {
        code: 'rollout_write_failed',
        message: `对话记录写入失败：${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
        retryable: true,
      }
      safeEmit({ type: 'error', threadId: deps.threadId, turnId, error, actions: errorActions(error) })
    })
    if (!terminal) {
      terminal = true
      const error = { code: 'internal', message: err instanceof Error ? err.message : String(err), retryable: true }
      safeEmit({ type: 'error', threadId: deps.threadId, turnId, error, actions: errorActions(error) })
      safeEmit({ type: 'turn.aborted', threadId: deps.threadId, turnId, reason: 'error', ...dropped })
    }
    return { status: 'aborted', turnId, reason: 'error', text: '' }
  }

  /** Empties the mailbox: what is still there never reached history, so its sender gets it back on turn.aborted. */
  const takeUnrecorded = (): { droppedClientInputIds?: string[] } => {
    const ids = mailbox.splice(0).flatMap((entry) => (entry.clientInputId ? [entry.clientInputId] : []))
    return ids.length > 0 ? { droppedClientInputIds: ids } : {}
  }

  const settle = (result: TurnResult): void => {
    clearTimer()
    done.resolve(result)
  }
  void run().then(settle, (err) => crashed(err).then(settle))

  return {
    turnId,
    promise: done.promise,
    steer(more, moreClientInputId) {
      if (loopDone || done.settled || controller.signal.aborted) return false
      mailbox.push(normalizeInput(more, moreClientInputId))
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
        emitError({
          code: 'rollout_write_failed',
          message: `对话记录写入失败：${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        })
        return false
      }
    }
    const finishAborted = async (reason: AbortReason): Promise<TurnResult> => {
      loopDone = true
      clearTimer()
      if (inputRecorded) drainMailbox()
      const dropped = takeUnrecorded()
      const item: TurnAbortedItem = { type: 'turn_aborted', id: newItemId(), turnId, createdAt: clock(), reason }
      deps.record([item])
      await services.hooks.run('TurnAborted', { threadId, turnId }).catch(() => undefined)
      await flushDurable()
      terminal = true
      emit({ type: 'turn.aborted', threadId, turnId, reason, ...dropped })
      return { status: 'aborted', turnId, reason, text: finalText }
    }
    const drainMailbox = (): void => {
      while (mailbox.length > 0) {
        const next = mailbox.shift()!
        const item: UserMessageItem = {
          type: 'user_message',
          id: newItemId(),
          turnId,
          createdAt: clock(),
          content: next.content,
          mentions: next.mentions,
        }
        deps.record([item])
        mentions.push(...next.mentions)
        emit({
          type: 'item.user',
          threadId,
          turnId,
          itemId: item.id,
          content: item.content,
          mentions: item.mentions,
          ...(next.clientInputId ? { clientInputId: next.clientInputId } : {}),
        })
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
    const buildRouter = (settings: ThreadSettings, model: ModelClient): ToolRouter =>
      services.tools.build({
        profile: settings.profile,
        depth: deps.depth,
        deny: [],
        localModel: model.ref.local,
        permissionMode: () => deps.settings().permissionMode,
        allowAlways: () => effectiveAllowAlways(deps.settings(), deps.globalAllowAlways?.() ?? [], deps.origin.channel),
        onAllowAlways: deps.onAllowAlways,
      })
    const computeUsage = (systemTokens: number, router: ToolRouter, model: ModelClient): ContextUsage =>
      deps.context.usage({
        systemTokens,
        toolSpecTokens: estimateTokens(JSON.stringify(router.specs)),
        maxTokens: model.ref.contextWindow,
      })
    const maybeCompact = async (usage: ContextUsage, model: ModelClient): Promise<void> => {
      if (!shouldCompact(usage, deps.config.compactionThreshold)) return
      try {
        const summary = await compactContext(
          {
            threadId,
            context: deps.context,
            contextWindow: model.ref.contextWindow,
            record: deps.record,
            persist: deps.persist,
            emit,
            signal: controller.signal,
            primaryModel: deps.settings().model,
          },
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
        emitError({
          code: 'compaction_failed',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        })
      }
    }

    // 1. UserPromptSubmit hook
    const firstInput = mailbox[0]!
    const firstText = inputText(firstInput)
    let hookContext: string | undefined
    let blockedReason: string | undefined
    try {
      const hook = await services.hooks.run('UserPromptSubmit', { threadId, turnId, text: firstText })
      blockedReason = hook.block?.reason
      hookContext = hook.additionalContext
    } catch (err) {
      // Only a failing hook is tolerated here; aborting the turn happens outside the try so its errors are not mistaken for hook errors.
      deps.logger?.('warn', 'UserPromptSubmit hook failed', err)
    }
    if (blockedReason !== undefined) {
      emitError({ code: 'hook_blocked', message: blockedReason, retryable: false })
      return finishAborted('error')
    }

    // 2. pre-turn compaction check
    let settings = deps.settings()
    let model = await resolveModel()
    if (!model) return finishAborted('error')
    let router = buildRouter(settings, model)
    deps.persist({
      ts: clock(),
      type: 'turn_context',
      turnId,
      modelId: model.ref.modelId,
      profile: settings.profile,
      permissionMode: settings.permissionMode,
    })
    {
      const stable = await deps.prompt.stablePrompt({ threadId, origin: deps.origin, settings })
      await maybeCompact(computeUsage(stable.tokens, router, model), model)
    }

    // 3. record user message(s) + turn-tier fragments
    drainMailbox()
    inputRecorded = true
    if (hookContext) recordFragment(createFragment('hook_context', '<hook_context>', 2000, () => hookContext))
    // `/技能 …`: the kernel loads the skill itself instead of hoping the model calls skill_view (skillInvocation.ts).
    const invokedSkill = await skillInvocationFragment(services.skills, firstInput, deps.origin.channel, deps.logger)
    if (invokedSkill) recordFragment(invokedSkill)
    // AGENTS rules are re-provided every turn for freshness but recorded only when the model has not seen this
    // exact text: the world-state baseline remembers a digest of the last recorded text (see step loop).
    let userInstructions: ContextFragment | undefined
    let userInstructionsDigest = ''
    for (const provider of services.fragmentProviders) {
      if (provider.tier !== 'turn') continue
      try {
        const fragments = await provider.provide({
          threadId,
          origin: deps.origin,
          settings,
          userText: firstText,
          mentions: [...mentions],
        })
        for (const f of fragments) {
          if (f.kind === 'user_instructions') {
            userInstructions = f
            userInstructionsDigest = digestFragment(f)
            continue
          }
          const wrapped =
            f.kind === 'observed_context' && f.marker !== '<observed_context>' ? observedContextFragment(f) : f
          recordFragment(wrapped)
        }
      } catch (err) {
        deps.logger?.('warn', 'fragment provider failed', err)
      }
    }

    // 4. step loop (re-entered at most MAX_STOP_CONTINUATIONS times when the Stop hook blocks)
    let stopContinuations = 0
    // The next step rewrites the answer after a blocking Stop hook.
    let revising = false
    // Length continuations used so far, and whether the next step continues a cut-off answer (stepEnd.ts).
    let lengthContinuations = 0
    let continuing = false
    turnLoop: for (;;) {
      while (true) {
        if (controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')
        drainMailbox()
        if (steps >= deps.maxSteps) return finishAborted('step_cap')
        settings = deps.settings()
        const resolved = await resolveModel()
        if (!resolved) return finishAborted('error')
        model = resolved
        router = buildRouter(settings, model)

        // (re-)inject the rules only when the digest the model last saw differs (also after compaction resets).
        if (userInstructions && deps.worldState.current()?.userInstructions !== userInstructionsDigest)
          recordFragment(userInstructions)
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
        const prompt = await deps.prompt.build({
          threadId,
          origin: deps.origin,
          settings,
          userText: firstText,
          mentions,
          date: new Date(clock()),
          usage: usageBefore,
        })
        const stepCtx = freezeStepContext({
          stepId: newStepId(),
          index: steps,
          model,
          router,
          settings,
          systemPrompt: prompt.system,
          cacheKey: prompt.cacheKey,
          revision: revising ? 'stop_hook' : undefined,
        })
        revising = false
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
          onApprovalWait: budget.pause,
          stream: deps.config.stream,
          logger: deps.logger,
        })
        steps++
        totalUsage = sumUsage(totalUsage, outcome.usage)
        // The answer is the last step's text. After a blocking Stop hook the model writes the whole answer again, so
        // the rewrite replaces the earlier one (the panel folds the superseded draft into the turn's work).
        const answerBefore = finalText
        if (outcome.text) finalText = continuing ? finalText + outcome.text : outcome.text
        continuing = false

        if (outcome.error) {
          emitError(outcome.error)
          return finishAborted('error')
        }
        if (outcome.aborted || controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')

        const usageAfter = computeUsage(prompt.stableTokens, router, model)
        emit({ type: 'context.usage', threadId, usage: usageAfter })

        if (outcome.loopGuard) return finishAborted('loop_guard')
        const verdict = judgeStepEnd(outcome, lengthContinuations, answerBefore, steps < deps.maxSteps)
        if (verdict.kind === 'fail') {
          emitError(verdict.error)
          return finishAborted('error')
        }
        if (verdict.kind === 'continue') {
          lengthContinuations++
          continuing = true
          emit({
            type: 'turn.continuing',
            threadId,
            turnId,
            attempt: lengthContinuations,
            max: MAX_LENGTH_CONTINUATIONS,
          })
          recordFragment(continuationFragment())
          continue
        }
        if (outcome.toolCalls.length === 0) {
          if (mailbox.length > 0) continue
          break
        }
        await maybeCompact(usageAfter, model)
        if (controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')
      }

      // 5. the step loop is over — from here on steer() refuses input (the Thread starts a new turn instead)
      loopDone = true
      const stop = await services.hooks
        .run('Stop', { threadId, turnId, text: finalText, origin: deps.origin, profile: deps.settings().profile })
        .catch((err) => {
          deps.logger?.('warn', 'Stop hook failed', err)
          return undefined
        })
      if (controller.signal.aborted) return finishAborted(abortReason ?? 'interrupted')
      const rewrite = Boolean(stop?.block) && stopContinuations < MAX_STOP_CONTINUATIONS && steps < deps.maxSteps
      recordTurnChecks(stop?.checks, rewrite, { threadId, turnId, record: deps.record, emit, clock })
      if (stop?.block && rewrite) {
        stopContinuations++
        revising = true
        const reason = stop.block.reason
        recordFragment(createFragment('stop_hook', '<stop_hook>', STOP_HOOK_TOKEN_CAP, () => reason))
        continue turnLoop
      }
      break
    }

    // 6. completed
    clearTimer()
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
