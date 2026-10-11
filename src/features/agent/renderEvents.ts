/**
 * The parts of the transcript that render a turn's work beyond text and plain tool rows — kept out of reducer.ts
 * (AGENTS §2.3). Pure: tested in renderEvents.test.ts.
 *   - tool.input: a call's arguments while the model writes them (the row appears early, its input fills in)
 *   - turn.check: an automatic check of the answer (引用核对) as a compact system row
 *   - subagent (with callId) + the child's own events: the sub-agent's work under the calling tool's row
 *   - update_plan: the plan card is drawn from the call's own input (live and after a reload)
 */
import type { CallId, Event, HistoryItem, JsonValue, SubagentTrace, ThreadId, TurnId } from '@aiwc/protocol'
import { createThreadView, type PlanStep, type SubagentRun, type ThreadItem, type ToolCallView } from './model'
import { parsePartialJson } from './partialJson'

/** Raw argument text kept per streaming row (the kernel stops streaming past its own cap). */
const MAX_INPUT_TEXT_CHARS = 64_000
export const PLAN_TOOL = 'update_plan'

type ToolsItem = Extract<ThreadItem, { kind: 'tools' }>
type ChildReducer = (view: ReturnType<typeof createThreadView>, e: Event) => ReturnType<typeof createThreadView>
type HistoryToItems = (history: HistoryItem[]) => ThreadItem[]

/* ------------------------------------------------------------------ tool rows */

function mapCalls(items: ThreadItem[], match: (c: ToolCallView) => boolean, patch: (c: ToolCallView) => ToolCallView) {
  let changed = false
  const next = items.map((it) => {
    if (it.kind !== 'tools' || !it.calls.some(match)) return it
    changed = true
    return { ...it, calls: it.calls.map((c) => (match(c) ? patch(c) : c)) }
  })
  return changed ? next : items
}

const hasCall = (items: ThreadItem[], callId: CallId) =>
  items.some((it) => it.kind === 'tools' && it.calls.some((c) => c.callId === callId))

/**
 * A `tool.input` delta: the row is created on the first one (pending, shimmering) and its input re-parsed from the
 * text so far. Once the call's own `tool.call` arrives the row stops listening (its input is final).
 */
export function applyToolInput(
  items: ThreadItem[],
  e: Extract<Event, { type: 'tool.input' }>,
  now: number,
  toolsId: (turnId: TurnId, callId: CallId) => string,
): ThreadItem[] {
  if (!hasCall(items, e.callId)) {
    const text = e.delta.slice(0, MAX_INPUT_TEXT_CHARS)
    const call: ToolCallView = {
      callId: e.callId,
      toolName: e.toolName,
      summary: '',
      status: 'pending',
      risk: 'read',
      input: parsePartialJson(text) ?? null,
      inputText: text,
      startedAt: now,
      kind: 'tool',
    }
    const last = items[items.length - 1]
    if (last?.kind === 'tools' && last.turnId === e.turnId)
      return [...items.slice(0, -1), { ...last, calls: [...last.calls, call] }]
    return [...items, { kind: 'tools', id: toolsId(e.turnId, e.callId), turnId: e.turnId, calls: [call] }]
  }
  return mapCalls(
    items,
    (c) => c.callId === e.callId && c.inputText !== undefined,
    (c) => {
      const text = ((c.inputText ?? '') + e.delta).slice(0, MAX_INPUT_TEXT_CHARS)
      return { ...c, inputText: text, input: parsePartialJson(text) ?? c.input }
    },
  )
}

/** A retried model request dropped its partial tool calls: rows still being written leave the turn. */
export function dropStreamingInputs(items: ThreadItem[], turnId: TurnId): ThreadItem[] {
  let changed = false
  const next: ThreadItem[] = []
  for (const it of items) {
    if (it.kind !== 'tools' || it.turnId !== turnId || !it.calls.some((c) => c.inputText !== undefined)) {
      next.push(it)
      continue
    }
    changed = true
    const calls = it.calls.filter((c) => c.inputText === undefined)
    if (calls.length) next.push({ ...it, calls })
  }
  return changed ? next : items
}

/** The call's own tool.call arrived: its input is final, the streamed text goes. */
export function finishToolInput(items: ThreadItem[], callId: CallId): ThreadItem[] {
  return mapCalls(
    items,
    (c) => c.callId === callId && c.inputText !== undefined,
    ({ inputText: _text, ...c }) => c,
  )
}

/* ------------------------------------------------------------------ checks */

export function appendCheck(items: ThreadItem[], e: Extract<Event, { type: 'turn.check' }>): ThreadItem[] {
  if (items.some((it) => it.id === e.itemId)) return items
  return [...items, { kind: 'check', id: e.itemId, turnId: e.turnId, check: e.check }]
}

/* ------------------------------------------------------------------ plan */

const PLAN_STATUSES: ReadonlySet<string> = new Set(['todo', 'doing', 'done', 'failed'])

/** The steps an update_plan input carries (malformed steps dropped); undefined when it carries none. */
export function planStepsOf(input: JsonValue | undefined): PlanStep[] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.steps)) return undefined
  const steps: PlanStep[] = []
  for (const s of input.steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue
    if (typeof s.title === 'string' && typeof s.status === 'string' && PLAN_STATUSES.has(s.status))
      steps.push({ title: s.title, status: s.status as PlanStep['status'] })
  }
  return steps.length ? steps : undefined
}

/** The turn's plan card shows the latest update_plan of the turn: updated in place, or added after its row. */
export function upsertPlan(items: ThreadItem[], turnId: TurnId, steps: PlanStep[]): ThreadItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it?.kind === 'plan' && it.turnId === turnId) {
      const next = items.slice()
      next[i] = { ...it, steps }
      return next
    }
  }
  return [...items, { kind: 'plan', id: `plan_${turnId}`, turnId, steps }]
}

/* ------------------------------------------------------------------ sub-agents */

function locateRun(items: ThreadItem[], childId: string): { item: number; call: number; run: number } | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it?.kind !== 'tools') continue
    for (let c = 0; c < it.calls.length; c++) {
      const r = it.calls[c]?.children?.findIndex((x) => x.childId === childId) ?? -1
      if (r >= 0) return { item: i, call: c, run: r }
    }
  }
  return undefined
}

function patchRun(items: ThreadItem[], childId: string, patch: (run: SubagentRun) => SubagentRun): ThreadItem[] {
  const at = locateRun(items, childId)
  if (!at) return items
  const group = items[at.item] as ToolsItem
  const call = group.calls[at.call] as ToolCallView
  const children = (call.children ?? []).slice()
  children[at.run] = patch(children[at.run] as SubagentRun)
  const calls = group.calls.slice()
  calls[at.call] = { ...call, children }
  const next = items.slice()
  next[at.item] = { ...group, calls }
  return next
}

/**
 * A `subagent` event that names its parent call: the child joins (or updates) that row's children. Returns
 * undefined when the call is not in the transcript (the caller then falls back to a row of its own).
 */
export function applySubagent(
  items: ThreadItem[],
  e: Extract<Event, { type: 'subagent' }>,
  now: number,
): ThreadItem[] | undefined {
  if (!e.callId || !hasCall(items, e.callId)) return undefined
  const status: SubagentRun['status'] = e.status === 'started' ? 'running' : e.status === 'done' ? 'done' : 'failed'
  if (locateRun(items, e.childId))
    return patchRun(items, e.childId, (run) => ({
      ...run,
      status,
      ...(status !== 'running' && run.startedAt !== undefined ? { durationMs: Math.max(0, now - run.startedAt) } : {}),
    }))
  const run: SubagentRun = {
    childId: e.childId,
    label: e.label,
    ...(e.step ? { step: e.step } : {}),
    status,
    items: [],
    startedAt: now,
  }
  return mapCalls(
    items,
    (c) => c.callId === e.callId,
    (c) => ({ ...c, children: [...(c.children ?? []), run] }),
  )
}

/**
 * One of the child's own events, folded into its run under the parent row with the same reducer as a thread
 * (`reduce` is reducer.ts reduceEvent, injected to keep the modules acyclic).
 */
export function applyChildEvent(items: ThreadItem[], childId: string, e: Event, reduce: ChildReducer): ThreadItem[] {
  return patchRun(items, childId, (run) => {
    const view = createThreadView(e.threadId, {
      items: run.items,
      isStreaming: run.status === 'running',
      currentTurnId: run.turnId,
      loaded: true,
    })
    const next = reduce(view, e)
    if (next === view) return run
    return { ...run, items: next.items, turnId: next.currentTurnId ?? run.turnId }
  })
}

const isTrace = (value: unknown): value is SubagentTrace =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as SubagentTrace).childId === 'string' &&
  typeof (value as SubagentTrace).label === 'string' &&
  Array.isArray((value as SubagentTrace).items)

/** Recorded traces (a tool result's `subagents`, untrusted JSON from the rollout) as runs. */
export function runsFromTraces(traces: unknown, toItems: HistoryToItems): SubagentRun[] | undefined {
  if (!Array.isArray(traces)) return undefined
  const runs: SubagentRun[] = []
  for (const trace of traces) {
    if (!isTrace(trace)) continue
    let items: ThreadItem[]
    try {
      items = toItems(trace.items)
    } catch {
      items = []
    }
    runs.push({
      childId: trace.childId,
      label: trace.label,
      ...(typeof trace.step === 'string' ? { step: trace.step } : {}),
      status: trace.status === 'done' ? 'done' : 'failed',
      items,
      ...(typeof trace.omitted === 'number' && trace.omitted > 0 ? { omitted: trace.omitted } : {}),
      ...(typeof trace.startedAt === 'number' ? { startedAt: trace.startedAt } : {}),
      ...(typeof trace.durationMs === 'number' ? { durationMs: trace.durationMs } : {}),
    })
  }
  return runs.length ? runs : undefined
}

/* ------------------------------------------------------------------ child routing */

/**
 * Which conversation a running child belongs to. Children are never listed threads, so their events are routed to
 * the parent's view by the store (agentEvents.ts) while they run; the entry goes when the child ends.
 */
const childParents = new Map<string, ThreadId>()

/** Note a `subagent` event (the store's side-effect pass, never the reducer). */
export function noteSubagent(e: Extract<Event, { type: 'subagent' }>): void {
  if (!e.callId) return
  if (e.status === 'started') childParents.set(e.childId, e.threadId)
  else childParents.delete(e.childId)
}

export function parentOfChild(threadId: ThreadId): ThreadId | undefined {
  return childParents.get(threadId)
}
