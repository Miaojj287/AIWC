/**
 * Tool execution within a step (ARCHITECTURE §4.4): parallel-safe tools share the lock, the rest run
 * exclusively; results come back IN CALL ORDER regardless of completion order. On interrupt each pending call
 * gets a 100ms grace period and is then recorded as an 'interrupted' error. An abandoned call releases the
 * per-thread lock right away (the zombie keeps running but no longer blocks the next turn) and its late
 * tool.call / tool.progress events are dropped.
 */
import { asCallId, newItemId, type CallId, type StepId, type ToolResultItem, type TurnId } from '@aiwc/protocol'
import type { ToolCallRequest, ToolDispatchContext, ToolDispatchOutcome, ToolRouter } from '../ports'
import { sleep } from './util/deferred'
import type { RwLock } from './util/rwlock'

export const INTERRUPT_GRACE_MS = 100

export interface ToolExecInput {
  calls: readonly ToolCallRequest[]
  router: ToolRouter
  ctx: ToolDispatchContext
  lock: RwLock
  graceMs?: number
}

export function interruptedOutcome(call: ToolCallRequest, durationMs: number): ToolDispatchOutcome {
  return {
    callId: call.callId,
    toolName: call.toolName,
    result: { content: '工具调用已中断', isError: true },
    isError: true,
    status: 'error',
    durationMs,
  }
}

async function raceWithGrace<T>(work: Promise<T>, signal: AbortSignal, graceMs: number, onInterrupted: () => T): Promise<T> {
  if (signal.aborted) {
    const winner = await Promise.race([work.then((v) => ({ v })), sleep(graceMs).then(() => undefined)])
    return winner ? winner.v : onInterrupted()
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    function onAbort(): void {
      void sleep(graceMs).then(() => finish(() => resolve(onInterrupted())))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    )
  })
}

/** Dispatch every call through the router under the RW gate; the returned array is in call order. */
export async function executeToolCalls(input: ToolExecInput): Promise<ToolDispatchOutcome[]> {
  const { calls, router, ctx, lock } = input
  const graceMs = input.graceMs ?? INTERRUPT_GRACE_MS
  const startedAt = Date.now()

  /** Calls whose outcome was already replaced by 'interrupted': their late events carry a dead turn id. */
  const abandoned = new Set<CallId>()
  const guardedCtx: ToolDispatchContext = {
    ...ctx,
    emit: (event) => {
      if ((event.type === 'tool.call' || event.type === 'tool.progress') && abandoned.has(event.callId)) return
      ctx.emit(event)
    },
  }

  const runOne = async (call: ToolCallRequest): Promise<ToolDispatchOutcome> => {
    const mode = router.has(call.toolName) && router.parallelSafe(call.toolName) ? 'shared' : 'exclusive'
    let release: (() => void) | undefined
    let released = false
    const releaseOnce = (): void => {
      if (released) return
      released = true
      release?.()
    }
    const work = (async () => {
      const acquired = await lock.acquire(mode)
      if (released) {
        // abandoned while still queued for the lock: give it straight back
        acquired()
        return interruptedOutcome(call, Date.now() - startedAt)
      }
      release = acquired
      try {
        if (ctx.signal.aborted) return interruptedOutcome(call, Date.now() - startedAt)
        return await router.dispatch(call, guardedCtx)
      } finally {
        releaseOnce()
      }
    })()
    const abandon = (): ToolDispatchOutcome => {
      abandoned.add(call.callId)
      releaseOnce()
      return interruptedOutcome(call, Date.now() - startedAt)
    }
    try {
      return await raceWithGrace(work, ctx.signal, graceMs, abandon)
    } catch (err) {
      return {
        callId: call.callId,
        toolName: call.toolName,
        result: { content: err instanceof Error ? err.message : String(err), isError: true },
        isError: true,
        status: 'error',
        durationMs: Date.now() - startedAt,
      }
    }
  }

  return Promise.all(calls.map(runOne))
}

export function outcomeToResultItem(outcome: ToolDispatchOutcome, ids: { turnId: TurnId; stepId: StepId }, at: number): ToolResultItem {
  const content = outcome.result.content
  return {
    type: 'tool_result',
    id: newItemId(),
    turnId: ids.turnId,
    stepId: ids.stepId,
    createdAt: at,
    callId: asCallId(outcome.callId as string) as CallId,
    toolName: outcome.toolName,
    output: typeof content === 'string' ? { type: 'text', text: content } : { type: 'json', value: content },
    isError: outcome.isError,
    durationMs: outcome.durationMs,
    truncated: false,
  }
}
