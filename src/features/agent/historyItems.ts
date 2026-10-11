/**
 * Kernel history → the panel's ThreadItems (hydration of a thread, before live events fold into it), the item ids the
 * live reducer shares with it, and looking up a turn's prompt. Pure — tested in reducer.test.ts.
 */
import { TurnCheckSchema, type CallId, type HistoryItem, type ThreadId, type TurnId } from '@aiwc/protocol'
import { t } from '@/i18n'
import {
  createThreadView,
  STOP_HOOK_FRAGMENT_KIND,
  type ThreadItem,
  type ThreadViewState,
  type ToolCallView,
} from './model'
import { PLAN_TOOL, planStepsOf, runsFromTraces, upsertPlan } from './renderEvents'
import { humanizeToolName } from './toolSummaries'

export const toolsItemId = (turnId: TurnId, callId: CallId) => `tools_${turnId}_${callId}`
export const artifactItemId = (callId: CallId, index: number) => `art_${callId}_${index}`

/* ------------------------------------------------------------------ history → items */

export function itemsFromHistory(history: HistoryItem[]): ThreadItem[] {
  let items: ThreadItem[] = []
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
        items.push({
          kind: 'user',
          id: h.id,
          turnId: h.turnId,
          content: h.content,
          mentions: h.mentions,
          createdAt: h.createdAt,
        })
        break
      case 'assistant_message':
        items.push({
          kind: 'assistant',
          id: h.id,
          turnId: h.turnId,
          text: h.text,
          reasoning: h.reasoning,
          streaming: false,
          modelId: h.modelId,
          createdAt: h.createdAt,
        })
        break
      case 'tool_call': {
        pushCall(h.turnId, {
          callId: h.callId,
          toolName: h.toolName,
          summary: humanizeToolName(h.toolName),
          ...(h.display && typeof h.display.code === 'string' ? { display: h.display } : {}),
          status: 'pending',
          risk: 'read',
          input: h.input,
          startedAt: h.createdAt,
          kind: 'tool',
        })
        // the plan card is the latest update_plan of the turn (the call's input is the plan)
        const plan = h.toolName === PLAN_TOOL ? planStepsOf(h.input) : undefined
        if (plan) items = upsertPlan(items, h.turnId, plan)
        break
      }
      case 'tool_result': {
        const ref = callIndex.get(h.callId)
        const output =
          h.output.type === 'json'
            ? h.output.value
            : h.output.type === 'text'
              ? h.output.text
              : t('agent.tool.imageOutput', { mediaType: h.output.mediaType })
        if (ref) {
          const group = items[ref.itemIndex]
          const call = group?.kind === 'tools' ? group.calls[ref.callIndex] : undefined
          if (call) {
            call.status = h.isError ? 'error' : 'done'
            call.output = output
            call.isError = h.isError
            call.durationMs = h.durationMs
            const children = runsFromTraces(h.subagents, itemsFromHistory)
            if (children) call.children = children
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
        // generated files recorded with the result keep their cards after a reload
        h.artifacts?.forEach((artifact, i) => {
          if (typeof artifact?.path === 'string' && typeof artifact.title === 'string')
            items.push({
              kind: 'artifact',
              id: artifactItemId(h.callId, i),
              turnId: h.turnId,
              callId: h.callId,
              artifact,
            })
        })
        break
      }
      case 'compaction_summary':
        items.push({
          kind: 'compaction',
          id: h.id,
          summaryItemId: h.id,
          summary: h.summary,
          foldedItemCount: h.foldedItemCount,
        })
        break
      case 'turn_aborted':
        items.push({ kind: 'aborted', id: h.id, turnId: h.turnId, reason: h.reason })
        break
      case 'context_fragment':
        if (h.kind === STOP_HOOK_FRAGMENT_KIND && h.turnId) items.push({ kind: 'revision', id: h.id, turnId: h.turnId })
        break
      case 'turn_check': {
        // a report a newer build shaped differently only loses its row
        const check = TurnCheckSchema.safeParse(h.check)
        if (check.success) items.push({ kind: 'check', id: h.id, turnId: h.turnId, check: check.data })
        break
      }
    }
  }

  // A recorded call without a result never finished (the turn was aborted mid-flight).
  for (const it of items) {
    if (it.kind !== 'tools') continue
    for (const c of it.calls) if (c.status === 'pending') c.status = 'error'
  }
  return items
}

export function viewFromHistory(threadId: ThreadId, history: HistoryItem[]): ThreadViewState {
  return createThreadView(threadId, { items: itemsFromHistory(history), loaded: true })
}

/** Last user input of a turn (for 重试 / 重新生成). Falls back to the most recent user item. */
export function findUserInput(items: ThreadItem[], turnId?: TurnId): Extract<ThreadItem, { kind: 'user' }> | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it?.kind === 'user' && (turnId === undefined || it.turnId === turnId)) return it
  }
  return undefined
}
