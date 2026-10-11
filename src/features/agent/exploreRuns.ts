/**
 * 查阅 grouping (CLAUDE.md §5): two or more read-only tool calls in a row fold into one 「查阅 · N 个步骤」 line. "In a
 * row" is what the reader sees: calls of the same turn with nothing between them but the model's thinking (a
 * reasoning-only reply, which then folds into the group as well, in order) — a reply with text, a plan, a write or
 * an approval breaks the run. A run's leading and trailing thoughts stay outside it. Pure — tested in
 * exploreRuns.test.ts.
 */
import type { ThreadItem, ToolCallView } from './model'
import { PLAN_TOOL } from './renderEvents'
import { toolCardFor } from './toolCards'

type ToolsItem = Extract<ThreadItem, { kind: 'tools' }>
type AssistantItem = Extract<ThreadItem, { kind: 'assistant' }>

/** Consecutive read-only calls fold under one 查阅 row once there are at least this many. */
export const EXPLORE_MIN_CALLS = 2

export type ExploreMember = { kind: 'call'; call: ToolCallView } | { kind: 'thought'; item: AssistantItem }

export type WorkEntry =
  | { kind: 'item'; item: ThreadItem }
  | { kind: 'explore'; id: string; turnId: ToolsItem['turnId']; members: ExploreMember[] }

/** A row that can hide in a 查阅 group: a plain read, not waiting on the user, without a card or sub-agents of its own. */
export function isExploreCall(c: ToolCallView): boolean {
  return (
    c.risk === 'read' &&
    c.kind !== 'subagent' &&
    c.status !== 'awaiting_approval' &&
    !c.children?.length &&
    toolCardFor(c.toolName)?.placement !== 'inline'
  )
}

/** The plan card stands for its update_plan rows (renderEvents.ts upsertPlan), so the rows are not drawn. */
export const isHiddenCall = (c: ToolCallView): boolean => c.toolName === PLAN_TOOL

const isThought = (it: ThreadItem): it is AssistantItem => it.kind === 'assistant' && !it.text.trim() && !it.streaming

type Token =
  | { kind: 'call'; call: ToolCallView; group: ToolsItem; explore: boolean }
  | { kind: 'thought'; item: AssistantItem }
  | { kind: 'other'; item: ThreadItem }

function tokenize(items: readonly ThreadItem[]): Token[] {
  const out: Token[] = []
  for (const item of items) {
    if (item.kind === 'tools') {
      for (const call of item.calls)
        if (!isHiddenCall(call)) out.push({ kind: 'call', call, group: item, explore: isExploreCall(call) })
    } else if (isThought(item)) out.push({ kind: 'thought', item })
    else out.push({ kind: 'other', item })
  }
  return out
}

/** Items in display order, with every run of ≥ EXPLORE_MIN_CALLS read-only calls folded into an explore entry. */
export function groupWork(items: readonly ThreadItem[]): WorkEntry[] {
  const tokens = tokenize(items)
  const out: WorkEntry[] = []
  // Non-explore calls are re-gathered into slices of their own tool group, so a group still renders as one block.
  let pending: { group: ToolsItem; calls: ToolCallView[] } | undefined
  const flushCalls = () => {
    if (pending) out.push({ kind: 'item', item: { ...pending.group, calls: pending.calls } })
    pending = undefined
  }
  const emitToken = (token: Token) => {
    if (token.kind === 'call') {
      if (pending && pending.group.id === token.group.id) pending.calls.push(token.call)
      else {
        flushCalls()
        pending = { group: token.group, calls: [token.call] }
      }
      return
    }
    flushCalls()
    out.push({ kind: 'item', item: token.item })
  }

  let i = 0
  while (i < tokens.length) {
    const start = tokens[i]
    if (!(start?.kind === 'call' && start.explore)) {
      if (start) emitToken(start)
      i++
      continue
    }
    // extend over explore calls and thoughts of the same turn; stop at anything else
    let end = i
    let calls = 0
    let lastCall = i
    for (let j = i; j < tokens.length; j++) {
      const tok = tokens[j]!
      if (tok.kind === 'call' && tok.explore && tok.group.turnId === start.group.turnId) {
        calls++
        lastCall = j
      } else if (tok.kind !== 'thought' || tok.item.turnId !== start.group.turnId) break
      end = j
    }
    end = lastCall // trailing thoughts stay outside the run
    if (calls >= EXPLORE_MIN_CALLS) {
      flushCalls()
      const members: ExploreMember[] = []
      for (let j = i; j <= end; j++) {
        const tok = tokens[j]!
        if (tok.kind === 'call') members.push({ kind: 'call', call: tok.call })
        else if (tok.kind === 'thought') members.push({ kind: 'thought', item: tok.item })
      }
      out.push({ kind: 'explore', id: `explore_${start.call.callId}`, turnId: start.group.turnId, members })
    } else for (let j = i; j <= end; j++) emitToken(tokens[j]!)
    i = end + 1
  }
  flushCalls()
  return out
}
