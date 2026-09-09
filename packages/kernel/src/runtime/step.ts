/**
 * Step = exactly one sampling request plus the tool calls it produced. The StepContext is frozen before the
 * request so late-arriving tool calls dispatch against the router/settings they were generated with.
 */
import {
  asCallId,
  newItemId,
  type AssistantMessageItem,
  type FinishReason,
  type HistoryItem,
  type JsonValue,
  type ModelClient,
  type ModelError,
  type SamplingRequest,
  type StepId,
  type ThreadId,
  type ThreadOrigin,
  type ThreadSettings,
  type TokenUsage,
  type ToolCallItem,
  type TurnId,
} from '@aiwc/protocol'
import type { ToolCallRequest, ToolDispatchOutcome, ToolRouter } from '../ports'
import type { ContextManager, RecordOptions } from './context/manager'
import type { Emitter } from './emitter'
import { executeToolCalls, outcomeToResultItem } from './toolExec'
import type { Logger } from './types'
import type { RwLock } from './util/rwlock'

/**
 * Sampling temperature per profile. Only role-play asks for one: a clone that answers at the
 * provider default sounds like a careful assistant wearing someone's name, which is the single most
 * common way an impersonation reads as fake. Everything else stays on the provider default (the
 * agent's job is to be right, not surprising).
 */
export const PROFILE_TEMPERATURE: Partial<Record<ThreadSettings['profile'], number>> = { persona: 0.85 }

export interface StepContext {
  readonly stepId: StepId
  readonly index: number
  readonly model: ModelClient
  readonly router: ToolRouter
  readonly settings: Readonly<ThreadSettings>
  readonly systemPrompt: string
  readonly cacheKey: string
}

export function freezeStepContext(ctx: StepContext): StepContext {
  return Object.freeze({ ...ctx, settings: Object.freeze({ ...ctx.settings }) })
}

export interface StepDeps {
  threadId: ThreadId
  turnId: TurnId
  origin: ThreadOrigin
  depth: number
  emit: Emitter['emit']
  context: ContextManager
  /** Records into the ContextManager AND persists; returns the items as recorded. */
  record: (items: HistoryItem[], opts?: RecordOptions) => HistoryItem[]
  signal: AbortSignal
  clock: () => number
  lock: RwLock
  /**
   * Consulted with the step's tool calls BEFORE any of them is dispatched (loop guard, ARCHITECTURE §4.5).
   * Returning true refuses the batch: every call is recorded as a 'loop guard' tool_result error, nothing runs,
   * and the outcome carries `loopGuard: true` so the turn aborts with reason 'loop_guard'.
   */
  beforeDispatch?: (calls: readonly ToolCallRequest[]) => boolean
  logger?: Logger
}

export const LOOP_GUARD_MESSAGE = 'loop guard'

/**
 * Tool outputs reach the step already bounded: ToolRouter.dispatch truncates to the tool's own maxOutputChars
 * (ports.ts "… → PostToolUse → truncate"), so the router is the single authoritative cut. Recording with the
 * generic default would silently cap every tool that declared a larger budget (ARCHITECTURE §5.4 "工具可覆盖").
 */
const ROUTER_BOUNDED_OUTPUT: RecordOptions = Object.freeze({ maxOutputChars: Number.POSITIVE_INFINITY })

export interface StepOutcome {
  text: string
  reasoning: string
  toolCalls: ToolCallRequest[]
  outcomes: ToolDispatchOutcome[]
  usage: TokenUsage
  finish: FinishReason
  error?: ModelError
  aborted: boolean
  /** The batch was refused by `beforeDispatch` (loop guard) and none of the calls ran. */
  loopGuard?: boolean
}

function loopGuardOutcome(call: ToolCallRequest): ToolDispatchOutcome {
  return { callId: call.callId, toolName: call.toolName, result: { content: LOOP_GUARD_MESSAGE, isError: true }, isError: true, status: 'error', durationMs: 0 }
}

export async function runStep(ctx: StepContext, deps: StepDeps): Promise<StepOutcome> {
  const { threadId, turnId, emit } = deps
  emit({ type: 'step.started', threadId, turnId, stepId: ctx.stepId, index: ctx.index })

  const request: SamplingRequest = {
    system: ctx.systemPrompt,
    history: deps.context.forPrompt(),
    tools: ctx.router.specs,
    toolChoice: ctx.router.specs.length > 0 ? 'auto' : 'none',
    maxOutputTokens: ctx.model.ref.maxOutputTokens,
    signal: deps.signal,
    cacheKey: ctx.cacheKey,
    ...(PROFILE_TEMPERATURE[ctx.settings.profile] !== undefined ? { temperature: PROFILE_TEMPERATURE[ctx.settings.profile] } : {}),
  }

  const itemId = newItemId()
  let text = ''
  let reasoning = ''
  let started = false
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  let finish: FinishReason = 'other'
  let error: ModelError | undefined
  const toolCalls: ToolCallRequest[] = []

  try {
    for await (const part of ctx.model.sample(request)) {
      switch (part.type) {
        case 'text.delta':
          if (!started) {
            started = true
            emit({ type: 'text.start', threadId, turnId, itemId })
          }
          text += part.delta
          emit({ type: 'text.delta', threadId, turnId, itemId, delta: part.delta })
          break
        case 'reasoning.delta':
          reasoning += part.delta
          emit({ type: 'reasoning.delta', threadId, turnId, itemId, delta: part.delta })
          break
        case 'tool_call':
          toolCalls.push({ callId: asCallId(part.callId), toolName: part.name, input: part.input })
          break
        case 'finish':
          usage = part.usage
          finish = part.reason
          break
        case 'error':
          error = part.error
          finish = 'error'
          break
      }
      if (error) break
    }
  } catch (err) {
    if (!deps.signal.aborted) {
      error = { code: 'unknown', message: err instanceof Error ? err.message : String(err), retryable: false }
      finish = 'error'
    }
  }
  const aborted = deps.signal.aborted || finish === 'aborted'

  const items: HistoryItem[] = []
  if (text || reasoning) {
    const msg: AssistantMessageItem = {
      type: 'assistant_message',
      id: itemId,
      turnId,
      stepId: ctx.stepId,
      createdAt: deps.clock(),
      text,
      reasoning: reasoning || undefined,
      modelId: ctx.model.ref.modelId,
    }
    items.push(msg)
  }
  if (!aborted && !error) {
    for (const call of toolCalls) {
      const item: ToolCallItem = {
        type: 'tool_call',
        id: newItemId(),
        turnId,
        stepId: ctx.stepId,
        createdAt: deps.clock(),
        callId: call.callId,
        toolName: call.toolName,
        input: (call.input ?? null) as ToolCallItem['input'],
      }
      items.push(item)
    }
  }
  if (items.length > 0) deps.record(items)
  if (started) emit({ type: 'text.end', threadId, turnId, itemId, text })

  if (error || aborted) {
    return { text, reasoning, toolCalls: aborted ? [] : toolCalls, outcomes: [], usage, finish, error, aborted }
  }
  if (toolCalls.length === 0) return { text, reasoning, toolCalls, outcomes: [], usage, finish, aborted: false }

  if (deps.beforeDispatch?.(toolCalls)) {
    // refused before dispatch: the model sees an error result per call, the UI a failed tool.call row
    const outcomes = toolCalls.map(loopGuardOutcome)
    const at = deps.clock()
    for (const call of toolCalls) {
      emit({
        type: 'tool.call',
        threadId,
        turnId,
        stepId: ctx.stepId,
        callId: call.callId,
        toolName: call.toolName,
        summary: ctx.router.has(call.toolName) ? ctx.router.summarize(call.toolName, call.input) : call.toolName,
        input: (call.input ?? null) as JsonValue,
        status: 'error',
        risk: ctx.router.risk(call.toolName) ?? 'read',
        startedAt: at,
        durationMs: 0,
        output: LOOP_GUARD_MESSAGE,
        isError: true,
      })
    }
    deps.record(outcomes.map((o) => outcomeToResultItem(o, { turnId, stepId: ctx.stepId }, at)))
    return { text, reasoning, toolCalls, outcomes, usage, finish, aborted: false, loopGuard: true }
  }

  const outcomes = await executeToolCalls({
    calls: toolCalls,
    router: ctx.router,
    lock: deps.lock,
    ctx: {
      threadId,
      turnId,
      stepId: ctx.stepId,
      channel: deps.origin.channel,
      profile: ctx.settings.profile,
      origin: deps.origin,
      depth: deps.depth,
      signal: deps.signal,
      emit,
    },
  })
  deps.record(
    outcomes.map((o) => outcomeToResultItem(o, { turnId, stepId: ctx.stepId }, deps.clock())),
    ROUTER_BOUNDED_OUTPUT,
  )
  return { text, reasoning, toolCalls, outcomes, usage, finish, aborted: deps.signal.aborted }
}
