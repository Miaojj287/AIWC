/**
 * Pure transformations: kernel HistoryItems → ThreadItems (hydration) and Event → ThreadViewState
 * (live folding). No IO, no React — tested in reducer.test.ts. Side effects (toasts, opening the
 * artifact tab) are decided by the store from the same events, never here.
 */
import type { CallId, Event, HistoryItem, ThreadId, ToolArtifact, TurnId } from '@aiwc/protocol'
import { createThreadView, type PlanStep, type ThreadItem, type ThreadViewState, type ToolCallView } from './model'

/** Tool names are snake_case; without a kernel summary we show them as words. */
export const humanizeToolName = (name: string): string => name.replace(/_/g, ' ')

const toolsItemId = (turnId: TurnId, callId: CallId) => `tools_${turnId}_${callId}`
const artifactItemId = (callId: CallId, index: number) => `art_${callId}_${index}`

/* ------------------------------------------------------------------ history → items */

export function itemsFromHistory(history: HistoryItem[]): ThreadItem[] {
  const items: ThreadItem[] = []
  const callIndex = new Map<CallId, { itemIndex: number; callIndex: number }>()

  const pushCall = (turnId: TurnId, call: ToolCallView) => {
    const last = items[items.length - 1]
    if (last && last.kind === 'tools' && last.turnId === turnId) {
      last.calls.push(call)
      callIndex.set(call.callId, { itemIndex: items.length - 1, callIndex: last.calls.length - 1 })
      return
    }
    items.push({ kind: 'tools', id: toolsItemId(turnId, call.callId), turnId, calls: [call] })
    callIndex.set(call.callId, { itemIndex: items.length - 1, callIndex: 0 })
  }

  for (const h of history) {
    switch (h.type) {
      case 'user_message':
        items.push({ kind: 'user', id: h.id, turnId: h.turnId, content: h.content, mentions: h.mentions, createdAt: h.createdAt })
        break
      case 'assistant_message':
        items.push({ kind: 'assistant', id: h.id, turnId: h.turnId, text: h.text, reasoning: h.reasoning, streaming: false, modelId: h.modelId, createdAt: h.createdAt })
        break
      case 'tool_call':
        pushCall(h.turnId, {
          callId: h.callId,
          toolName: h.toolName,
          summary: humanizeToolName(h.toolName),
          status: 'pending',
          risk: 'read',
          input: h.input,
          startedAt: h.createdAt,
          kind: 'tool',
        })
        break
      case 'tool_result': {
        const ref = callIndex.get(h.callId)
        const output = h.output.type === 'json' ? h.output.value : h.output.type === 'text' ? h.output.text : `[图片 ${h.output.mediaType}]`
        if (ref) {
          const group = items[ref.itemIndex]
          const call = group?.kind === 'tools' ? group.calls[ref.callIndex] : undefined
          if (call) {
            call.status = h.isError ? 'error' : 'done'
            call.output = output
            call.isError = h.isError
            call.durationMs = h.durationMs
          }
        } else {
          pushCall(h.turnId, {
            callId: h.callId,
            toolName: h.toolName,
            summary: humanizeToolName(h.toolName),
            status: h.isError ? 'error' : 'done',
            risk: 'read',
            input: null,
            output,
            isError: h.isError,
            startedAt: h.createdAt - h.durationMs,
            durationMs: h.durationMs,
            kind: 'tool',
          })
        }
        break
      }
      case 'compaction_summary':
        items.push({ kind: 'compaction', id: h.id, summaryItemId: h.id, summary: h.summary, foldedItemCount: h.foldedItemCount })
        break
      case 'turn_aborted':
        items.push({ kind: 'aborted', id: h.id, turnId: h.turnId, reason: h.reason })
        break
      case 'context_fragment':
        break
    }
  }

  // A recorded call without a result never finished (the turn was aborted mid-flight).
  for (const it of items) {
    if (it.kind !== 'tools') continue
    for (const c of it.calls) if (c.status === 'pending') c.status = 'error'
  }
  return items
}

/* ------------------------------------------------------------------ event → state */

export interface ReduceOptions {
  /** injectable clock for streaming durations */
  now?: () => number
}

/** Fold one kernel Event into a thread view. Events for other threads are ignored. */
export function reduceEvent(state: ThreadViewState, e: Event, opts: ReduceOptions = {}): ThreadViewState {
  if (e.threadId !== state.threadId) return state
  const now = opts.now ?? Date.now
  switch (e.type) {
    case 'item.user':
      return withItems(state, append(state.items, { kind: 'user', id: e.itemId, turnId: e.turnId, content: e.content, mentions: e.mentions, createdAt: now() }), {
        suggestions: undefined,
      })

    case 'turn.started':
      return { ...state, isStreaming: true, currentTurnId: e.turnId, turnStartedAt: e.at }

    case 'text.start':
      return withItems(state, append(state.items, { kind: 'assistant', id: e.itemId, turnId: e.turnId, text: '', streaming: true, startedAt: now(), createdAt: now() }), {
        isStreaming: true,
        currentTurnId: state.currentTurnId ?? e.turnId,
      })

    case 'text.delta':
      return withItems(
        state,
        upsertAssistant(state.items, e.itemId, e.turnId, now, (a) => ({ ...a, text: a.text + e.delta })),
      )

    case 'reasoning.delta':
      return withItems(
        state,
        upsertAssistant(state.items, e.itemId, e.turnId, now, (a) => ({ ...a, reasoning: (a.reasoning ?? '') + e.delta })),
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
      const call: Partial<ToolCallView> & Pick<ToolCallView, 'callId' | 'toolName' | 'summary' | 'status' | 'risk' | 'input' | 'startedAt'> = {
        callId: e.callId,
        toolName: e.toolName,
        summary: e.summary || humanizeToolName(e.toolName),
        status: e.status,
        risk: e.risk,
        input: e.input,
        startedAt: e.startedAt,
        durationMs: e.durationMs,
        output: e.output,
        isError: e.isError,
        artifacts: e.artifacts,
        kind: 'tool',
      }
      let items = upsertCall(state.items, e.turnId, call)
      if (e.status === 'done' && e.artifacts?.length) items = appendArtifacts(items, e.turnId, e.callId, e.artifacts)
      return withItems(state, items)
    }

    case 'tool.progress':
      return withItems(state, patchCall(state.items, e.callId, (c) => ({ ...c, progress: e.message })))

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
              detail: e.detail,
              input: e.input,
              risk: e.risk,
              canAllowAlways: e.canAllowAlways,
            },
          ]
      const items = upsertCall(state.items, e.turnId, {
        callId: e.callId,
        toolName: e.toolName,
        summary: e.summary || humanizeToolName(e.toolName),
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
          ? { ...c, approvalId: undefined, status: e.decision === 'deny' ? 'denied' : 'running', ...(e.decision === 'deny' ? { isError: true, durationMs: 0 } : {}) }
          : { ...c, approvalId: undefined },
      )
      return withItems(state, items, { pendingApprovals })
    }

    case 'context.usage': {
      const ratio = e.usage.maxTokens > 0 ? e.usage.usedTokens / e.usage.maxTokens : 0
      return { ...state, usage: e.usage, usageWarned: ratio >= 0.8 ? state.usageWarned : false }
    }

    case 'context.compacted':
      return withItems(state, append(state.items, { kind: 'compaction', id: `cmp_${e.summaryItemId}`, summaryItemId: e.summaryItemId, freedTokens: e.freedTokens }))

    case 'plan.updated': {
      const steps: PlanStep[] = e.steps.map((s) => ({ title: s.title, status: s.status }))
      const idx = findLastIndex(state.items, (it) => it.kind === 'plan' && (state.currentTurnId === undefined || it.turnId === state.currentTurnId))
      if (idx >= 0) {
        const items = state.items.slice()
        const existing = items[idx]
        if (existing && existing.kind === 'plan') items[idx] = { ...existing, steps }
        return withItems(state, items)
      }
      return withItems(state, append(state.items, { kind: 'plan', id: `plan_${state.currentTurnId ?? 'x'}_${state.items.length}`, turnId: state.currentTurnId, steps }))
    }

    case 'turn.completed': {
      let items = finalizeStreaming(state.items, e.turnId, now)
      const hasAssistant = items.some((it) => it.kind === 'assistant' && it.turnId === e.turnId)
      if (!hasAssistant && e.finalText.trim()) {
        items = append(items, { kind: 'assistant', id: `final_${e.turnId}`, turnId: e.turnId, text: e.finalText, streaming: false, createdAt: e.at })
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
          ? { ...it, calls: it.calls.map((c) => (isOpen(c.status) ? { ...c, status: c.status === 'awaiting_approval' ? 'denied' : 'error', approvalId: undefined, isError: true } : c)) }
          : it,
      )
      if (e.reason !== 'error') items = append(items, { kind: 'aborted', id: `abort_${e.turnId}`, turnId: e.turnId, reason: e.reason })
      return withItems(state, items, {
        isStreaming: false,
        currentTurnId: undefined,
        turnStartedAt: undefined,
        pendingApprovals: state.pendingApprovals.filter((a) => a.turnId !== e.turnId),
      })
    }

    case 'error':
      return withItems(state, append(state.items, { kind: 'error', id: `err_${e.turnId ?? 'x'}_${state.items.length}`, turnId: e.turnId, error: e.error, actions: e.actions }))

    case 'subagent': {
      const status: ToolCallView['status'] = e.status === 'started' ? 'running' : e.status === 'done' ? 'done' : 'error'
      const callId = `sub_${e.childId}` as CallId
      const turnId = state.currentTurnId ?? (`trn_${e.childId}` as TurnId)
      return withItems(
        state,
        upsertCall(state.items, turnId, { callId, toolName: 'delegate', summary: e.label, status, risk: 'read', input: null, startedAt: now(), kind: 'subagent', isError: e.status === 'failed' }),
      )
    }

    case 'thread.created':
    case 'thread.settings':
    case 'thread.title':
    case 'memory.written':
    case 'step.started':
      return state
  }
  return state
}

/** Fold a whole event sequence (tests / replay). */
export function reduceEvents(state: ThreadViewState, events: Event[], opts?: ReduceOptions): ThreadViewState {
  return events.reduce((s, e) => reduceEvent(s, e, opts), state)
}

export function viewFromHistory(threadId: ThreadId, history: HistoryItem[]): ThreadViewState {
  return createThreadView(threadId, { items: itemsFromHistory(history), loaded: true })
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

function upsertAssistant(items: ThreadItem[], itemId: string, turnId: TurnId, now: () => number, patch: (a: AssistantItem) => AssistantItem): ThreadItem[] {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === itemId)
  if (idx < 0) {
    // delta without a start (out-of-order or replay): create the item so no text is lost
    return append(items, patch({ kind: 'assistant', id: itemId, turnId, text: '', streaming: true, startedAt: now(), createdAt: now() }))
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
function upsertCall(items: ThreadItem[], turnId: TurnId, call: Partial<ToolCallView> & Pick<ToolCallView, 'callId'>): ThreadItem[] {
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
  if (next.status === 'done' || next.status === 'error' || next.status === 'denied' || next.status === 'timeout') next.progress = undefined
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
    return { ...it, streaming: false, durationMs: it.durationMs ?? (it.startedAt !== undefined ? Math.max(0, now() - it.startedAt) : undefined) }
  })
  return changed ? next : items
}

/** Last user input of a turn (for 重试 / 重新生成). Falls back to the most recent user item. */
export function findUserInput(items: ThreadItem[], turnId?: TurnId): Extract<ThreadItem, { kind: 'user' }> | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it?.kind === 'user' && (turnId === undefined || it.turnId === turnId)) return it
  }
  return undefined
}
