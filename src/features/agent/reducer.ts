/**
 * Pure transformation Event → ThreadViewState (live folding; hydrating a thread from its history is historyItems.ts).
 * No IO, no React — tested in reducer.test.ts. Side effects (toasts, opening the artifact tab) are decided by the
 * store from the same events, never here.
 */
import type { CallId, Event, ToolArtifact, TurnId } from '@aiwc/protocol'
import { type PlanStep, type ThreadItem, type ThreadViewState, type ToolCallView } from './model'
import { artifactItemId, itemsFromHistory, toolsItemId } from './historyItems'
import {
  appendCheck,
  applySubagent,
  applyToolInput,
  dropStreamingInputs,
  finishToolInput,
  PLAN_TOOL,
  planStepsOf,
  runsFromTraces,
  upsertPlan,
} from './renderEvents'
import { humanizeToolName } from './toolSummaries'
import { withoutPendingInput } from './pendingInputs'
import { reduceTurnSignals } from './turnSignals'
import { reduceDroppedInputs } from './restoreInput'

/* ------------------------------------------------------------------ event → state */

export interface ReduceOptions {
  /** injectable clock for streaming durations */
  now?: () => number
}

/** Fold one kernel Event into a thread view. Events for other threads are ignored. */
export function reduceEvent(state: ThreadViewState, e: Event, opts: ReduceOptions = {}): ThreadViewState {
  if (e.threadId !== state.threadId) return state
  return reduceDroppedInputs(reduceTurnSignals(reduceTranscript(state, e, opts), e), e)
}

/** Everything except the turn signals (questions, reconnecting / continuing), which turnSignals.ts folds. */
function reduceTranscript(state: ThreadViewState, e: Event, opts: ReduceOptions): ThreadViewState {
  const now = opts.now ?? Date.now
  switch (e.type) {
    case 'item.user':
      return withItems(
        state,
        append(state.items, {
          kind: 'user',
          id: e.itemId,
          turnId: e.turnId,
          content: e.content,
          mentions: e.mentions,
          createdAt: now(),
        }),
        { pendingInputs: withoutPendingInput(state.pendingInputs, e.clientInputId) },
      )

    case 'turn.started':
      return { ...state, isStreaming: true, currentTurnId: e.turnId, turnStartedAt: e.at }

    case 'text.start':
      return withItems(
        state,
        append(state.items, {
          kind: 'assistant',
          id: e.itemId,
          turnId: e.turnId,
          text: '',
          streaming: true,
          startedAt: now(),
          createdAt: now(),
        }),
        {
          isStreaming: true,
          currentTurnId: state.currentTurnId ?? e.turnId,
        },
      )

    case 'text.delta':
      return withItems(
        state,
        upsertAssistant(state.items, e.itemId, e.turnId, now, (a) => ({ ...a, text: a.text + e.delta })),
      )

    case 'reasoning.delta':
      return withItems(
        state,
        upsertAssistant(state.items, e.itemId, e.turnId, now, (a) => ({
          ...a,
          reasoning: (a.reasoning ?? '') + e.delta,
        })),
      )

    case 'text.end':
      return withItems(
        state,
        upsertAssistant(state.items, e.itemId, e.turnId, now, (a) => ({
          ...a,
          text: e.text,
          streaming: false,
          durationMs: a.startedAt !== undefined ? Math.max(0, now() - a.startedAt) : a.durationMs,
        })),
      )

    case 'tool.call': {
      const call: Partial<ToolCallView> &
        Pick<ToolCallView, 'callId' | 'toolName' | 'summary' | 'status' | 'risk' | 'input' | 'startedAt'> = {
        callId: e.callId,
        toolName: e.toolName,
        summary: e.summary || humanizeToolName(e.toolName),
        display: e.display,
        status: e.status,
        risk: e.risk,
        input: e.input,
        startedAt: e.startedAt,
        durationMs: e.durationMs,
        output: e.output,
        isError: e.isError,
        artifacts: e.artifacts,
        // the recorded traces replace the live view of the call's sub-agents (the same rows history shows)
        children: runsFromTraces(e.subagents, itemsFromHistory),
        kind: 'tool',
      }
      // tools run once sampling is over: a reasoning-only reply of the step (no text.end) is finished too
      let items = finishToolInput(upsertCall(finalizeStreaming(state.items, e.turnId, now), e.turnId, call), e.callId)
      if (e.status === 'done' && e.artifacts?.length) items = appendArtifacts(items, e.turnId, e.callId, e.artifacts)
      const plan = e.toolName === PLAN_TOOL ? planStepsOf(e.input) : undefined
      if (plan) items = upsertPlan(items, e.turnId, plan)
      return withItems(state, items)
    }

    case 'tool.input':
      return withItems(state, applyToolInput(state.items, e, now(), toolsItemId))

    case 'turn.check':
      return withItems(state, appendCheck(state.items, e))

    case 'tool.progress':
      return withItems(
        state,
        patchCall(state.items, e.callId, (c) => ({
          ...c,
          progress: e.message,
          ...(e.detail !== undefined ? { progressDetail: e.detail } : {}),
        })),
      )

    case 'approval.requested': {
      const pending = state.pendingApprovals.some((a) => a.approvalId === e.approvalId)
        ? state.pendingApprovals
        : [
            ...state.pendingApprovals,
            {
              approvalId: e.approvalId,
              callId: e.callId,
              turnId: e.turnId,
              toolName: e.toolName,
              summary: e.summary,
              ...(e.display ? { display: e.display } : {}),
              detail: e.detail,
              input: e.input,
              risk: e.risk,
              canAllowAlways: e.canAllowAlways,
              ...(e.allowKey ? { allowKey: e.allowKey } : {}),
            },
          ]
      const items = upsertCall(state.items, e.turnId, {
        callId: e.callId,
        toolName: e.toolName,
        summary: e.summary || humanizeToolName(e.toolName),
        display: e.display,
        status: 'awaiting_approval',
        risk: e.risk,
        input: e.input,
        startedAt: now(),
        approvalId: e.approvalId,
        kind: 'tool',
      })
      return withItems(state, items, { pendingApprovals: pending })
    }

    case 'approval.resolved': {
      const req = state.pendingApprovals.find((a) => a.approvalId === e.approvalId)
      const pendingApprovals = state.pendingApprovals.filter((a) => a.approvalId !== e.approvalId)
      if (!req) return { ...state, pendingApprovals }
      const items = patchCall(state.items, req.callId, (c) =>
        c.status === 'awaiting_approval'
          ? {
              ...c,
              approvalId: undefined,
              status: e.decision === 'deny' ? 'denied' : 'running',
              ...(e.decision === 'deny' ? { isError: true, durationMs: 0 } : {}),
            }
          : { ...c, approvalId: undefined },
      )
      return withItems(state, items, { pendingApprovals })
    }

    case 'context.usage': {
      const ratio = e.usage.maxTokens > 0 ? e.usage.usedTokens / e.usage.maxTokens : 0
      return { ...state, usage: e.usage, usageWarned: ratio >= 0.8 ? state.usageWarned : false }
    }

    case 'context.compacted':
      return withItems(
        state,
        append(state.items, {
          kind: 'compaction',
          id: `cmp_${e.summaryItemId}`,
          summaryItemId: e.summaryItemId,
          freedTokens: e.freedTokens,
        }),
      )

    case 'plan.updated': {
      const steps: PlanStep[] = e.steps.map((s) => ({ title: s.title, status: s.status }))
      const idx = findLastIndex(
        state.items,
        (it) => it.kind === 'plan' && (state.currentTurnId === undefined || it.turnId === state.currentTurnId),
      )
      if (idx >= 0) {
        const items = state.items.slice()
        const existing = items[idx]
        if (existing && existing.kind === 'plan') items[idx] = { ...existing, steps }
        return withItems(state, items)
      }
      return withItems(
        state,
        append(state.items, {
          kind: 'plan',
          id: `plan_${state.currentTurnId ?? 'x'}_${state.items.length}`,
          turnId: state.currentTurnId,
          steps,
        }),
      )
    }

    case 'turn.completed': {
      let items = finalizeStreaming(state.items, e.turnId, now)
      const hasAssistant = items.some((it) => it.kind === 'assistant' && it.turnId === e.turnId)
      if (!hasAssistant && e.finalText.trim()) {
        items = append(items, {
          kind: 'assistant',
          id: `final_${e.turnId}`,
          turnId: e.turnId,
          text: e.finalText,
          streaming: false,
          createdAt: e.at,
        })
      }
      return withItems(state, items, {
        isStreaming: false,
        currentTurnId: undefined,
        turnStartedAt: undefined,
        pendingApprovals: state.pendingApprovals.filter((a) => a.turnId !== e.turnId),
      })
    }

    case 'turn.aborted': {
      let items = finalizeStreaming(state.items, e.turnId, now)
      items = items.map((it) =>
        it.kind === 'tools' && it.turnId === e.turnId
          ? {
              ...it,
              calls: it.calls.map((c) =>
                isOpen(c.status)
                  ? {
                      ...c,
                      status: c.status === 'awaiting_approval' ? 'denied' : 'error',
                      approvalId: undefined,
                      isError: true,
                    }
                  : c,
              ),
            }
          : it,
      )
      if (e.reason !== 'error')
        items = append(items, { kind: 'aborted', id: `abort_${e.turnId}`, turnId: e.turnId, reason: e.reason })
      return withItems(state, items, {
        isStreaming: false,
        currentTurnId: undefined,
        turnStartedAt: undefined,
        pendingApprovals: state.pendingApprovals.filter((a) => a.turnId !== e.turnId),
      })
    }

    case 'error':
      return withItems(
        state,
        append(state.items, {
          kind: 'error',
          id: `err_${e.turnId ?? 'x'}_${state.items.length}`,
          turnId: e.turnId,
          error: e.error,
          actions: e.actions,
        }),
      )

    case 'subagent': {
      // a child that names its parent call shows under that row; older events stand as rows of their own
      const attached = applySubagent(state.items, e, now())
      if (attached) return withItems(state, attached)
      const status: ToolCallView['status'] = e.status === 'started' ? 'running' : e.status === 'done' ? 'done' : 'error'
      const callId = `sub_${e.childId}` as CallId
      const turnId = state.currentTurnId ?? (`trn_${e.childId}` as TurnId)
      return withItems(
        state,
        upsertCall(state.items, turnId, {
          callId,
          toolName: 'delegate',
          summary: e.label,
          status,
          risk: 'read',
          input: null,
          startedAt: now(),
          kind: 'subagent',
          isError: e.status === 'failed',
        }),
      )
    }

    case 'step.started':
      if (!e.revision) return state
      return withItems(state, append(state.items, { kind: 'revision', id: `revision_${e.stepId}`, turnId: e.turnId }))
    case 'thread.created':
    case 'thread.settings':
    case 'thread.title':
    case 'memory.written':
    case 'question.requested':
    case 'question.resolved':
    case 'turn.continuing':
      return state
    case 'stream.retrying':
      return withItems(state, dropStreamingInputs(state.items, e.turnId))
  }
  return state
}

/** Fold a whole event sequence (tests / replay). */
export function reduceEvents(state: ThreadViewState, events: Event[], opts?: ReduceOptions): ThreadViewState {
  return events.reduce((s, e) => reduceEvent(s, e, opts), state)
}

/* ------------------------------------------------------------------ helpers */

const isOpen = (s: ToolCallView['status']) => s === 'pending' || s === 'running' || s === 'awaiting_approval'

function withItems(state: ThreadViewState, items: ThreadItem[], patch: Partial<ThreadViewState> = {}): ThreadViewState {
  return { ...state, items, ...patch }
}

function append(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  return [...items, item]
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i] as T)) return i
  return -1
}

type AssistantItem = Extract<ThreadItem, { kind: 'assistant' }>

function upsertAssistant(
  items: ThreadItem[],
  itemId: string,
  turnId: TurnId,
  now: () => number,
  patch: (a: AssistantItem) => AssistantItem,
): ThreadItem[] {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === itemId)
  if (idx < 0) {
    // delta without a start (out-of-order or replay): create the item so no text is lost
    return append(
      items,
      patch({ kind: 'assistant', id: itemId, turnId, text: '', streaming: true, startedAt: now(), createdAt: now() }),
    )
  }
  const next = items.slice()
  next[idx] = patch(items[idx] as AssistantItem)
  return next
}

function locateCall(items: ThreadItem[], callId: CallId): { itemIndex: number; callIndex: number } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it?.kind !== 'tools') continue
    const ci = it.calls.findIndex((c) => c.callId === callId)
    if (ci >= 0) return { itemIndex: i, callIndex: ci }
  }
  return undefined
}

function patchCall(items: ThreadItem[], callId: CallId, patch: (c: ToolCallView) => ToolCallView): ThreadItem[] {
  const loc = locateCall(items, callId)
  if (!loc) return items
  const group = items[loc.itemIndex]
  if (!group || group.kind !== 'tools') return items
  const calls = group.calls.slice()
  calls[loc.callIndex] = patch(group.calls[loc.callIndex] as ToolCallView)
  const next = items.slice()
  next[loc.itemIndex] = { ...group, calls }
  return next
}

/**
 * Update the call with this callId wherever it lives; otherwise add it to the trailing tool group of
 * the same turn, or start a new group. Existing fields survive undefined patches (a `running`
 * event does not erase `output`, a later `done` supplies it).
 */
function upsertCall(
  items: ThreadItem[],
  turnId: TurnId,
  call: Partial<ToolCallView> & Pick<ToolCallView, 'callId'>,
): ThreadItem[] {
  const loc = locateCall(items, call.callId)
  if (loc) {
    return patchCall(items, call.callId, (c) => mergeCall(c, call))
  }
  const full: ToolCallView = {
    callId: call.callId,
    toolName: call.toolName ?? 'tool',
    summary: call.summary ?? humanizeToolName(call.toolName ?? 'tool'),
    status: call.status ?? 'pending',
    risk: call.risk ?? 'read',
    input: call.input ?? null,
    startedAt: call.startedAt ?? 0,
    durationMs: call.durationMs,
    output: call.output,
    isError: call.isError,
    artifacts: call.artifacts,
    approvalId: call.approvalId,
    progress: call.progress,
    kind: call.kind ?? 'tool',
    ...(call.display ? { display: call.display } : {}),
    ...(call.children ? { children: call.children } : {}),
  }
  const last = items[items.length - 1]
  if (last && last.kind === 'tools' && last.turnId === turnId) {
    const next = items.slice()
    next[items.length - 1] = { ...last, calls: [...last.calls, full] }
    return next
  }
  return append(items, { kind: 'tools', id: toolsItemId(turnId, full.callId), turnId, calls: [full] })
}

function mergeCall(current: ToolCallView, patch: Partial<ToolCallView>): ToolCallView {
  const next: ToolCallView = { ...current }
  for (const [k, v] of Object.entries(patch) as Array<[keyof ToolCallView, unknown]>) {
    if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v
  }
  // a finished call no longer waits for approval
  if (next.status !== 'awaiting_approval') next.approvalId = undefined
  if (next.status === 'done' || next.status === 'error' || next.status === 'denied' || next.status === 'timeout')
    next.progress = undefined
  return next
}

function appendArtifacts(items: ThreadItem[], turnId: TurnId, callId: CallId, artifacts: ToolArtifact[]): ThreadItem[] {
  let next = items
  artifacts.forEach((artifact, i) => {
    const id = artifactItemId(callId, i)
    if (next.some((it) => it.id === id)) return
    next = append(next, { kind: 'artifact', id, turnId, callId, artifact })
  })
  return next
}

function finalizeStreaming(items: ThreadItem[], turnId: TurnId, now: () => number): ThreadItem[] {
  let changed = false
  const next = items.map((it) => {
    if (it.kind !== 'assistant' || it.turnId !== turnId || !it.streaming) return it
    changed = true
    return {
      ...it,
      streaming: false,
      durationMs: it.durationMs ?? (it.startedAt !== undefined ? Math.max(0, now() - it.startedAt) : undefined),
    }
  })
  return changed ? next : items
}
