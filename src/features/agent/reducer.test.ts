import { describe, expect, it } from 'vitest'
import type { ApprovalId, CallId, Event, HistoryItem, ItemId, StepId, ThreadId, TurnId } from '@aiwc/protocol'
import { createThreadView } from './model'
import { findUserInput, itemsFromHistory, reduceEvents, viewFromHistory } from './reducer'

const threadId = 'thr_test' as ThreadId
const turnId = 'trn_1' as TurnId
const stepId = 'stp_1' as StepId
const call1 = 'cal_1' as CallId
const call2 = 'cal_2' as CallId
const approvalId = 'apr_1' as ApprovalId

let clock = 1_000
const now = () => clock
const tick = (ms: number) => {
  clock += ms
}

const base = { threadId, turnId }

const toolCall = (over: Partial<Extract<Event, { type: 'tool.call' }>>): Event => ({
  type: 'tool.call',
  ...base,
  stepId,
  callId: call1,
  toolName: 'search_messages',
  summary: '搜索“评审”',
  input: { query: '评审' },
  status: 'pending',
  risk: 'read',
  startedAt: 1_000,
  ...over,
})

describe('reduceEvents — text streaming', () => {
  it('builds a user item, streams assistant text and finalises on turn.completed', () => {
    clock = 1_000
    const events: Event[] = [
      { type: 'item.user', ...base, itemId: 'itm_u' as ItemId, content: [{ type: 'text', text: '帮我总结' }], mentions: [{ kind: 'session', id: 's1', label: '产品市场群' }] },
      { type: 'turn.started', ...base, at: 1_000 },
      { type: 'text.start', ...base, itemId: 'itm_a' as ItemId },
      { type: 'text.delta', ...base, itemId: 'itm_a' as ItemId, delta: '好的，' },
      { type: 'text.delta', ...base, itemId: 'itm_a' as ItemId, delta: '我先读取' },
    ]
    let state = reduceEvents(createThreadView(threadId, { suggestions: ['a'] }), events, { now })
    expect(state.isStreaming).toBe(true)
    expect(state.currentTurnId).toBe(turnId)
    expect(state.suggestions).toBeUndefined()
    expect(state.items).toHaveLength(2)
    const assistant = state.items[1]
    expect(assistant?.kind).toBe('assistant')
    if (assistant?.kind !== 'assistant') throw new Error('expected assistant')
    expect(assistant.text).toBe('好的，我先读取')
    expect(assistant.streaming).toBe(true)

    tick(3_200)
    state = reduceEvents(
      state,
      [
        { type: 'text.end', ...base, itemId: 'itm_a' as ItemId, text: '好的，我先读取该群今天的消息。' },
        { type: 'turn.completed', ...base, finalText: '好的，我先读取该群今天的消息。', usage: { inputTokens: 10, outputTokens: 5 }, steps: 1, at: 4_200 },
      ],
      { now },
    )
    const done = state.items[1]
    if (done?.kind !== 'assistant') throw new Error('expected assistant')
    expect(done.streaming).toBe(false)
    expect(done.text).toBe('好的，我先读取该群今天的消息。')
    expect(done.durationMs).toBe(3_200)
    expect(state.isStreaming).toBe(false)
    expect(state.currentTurnId).toBeUndefined()
    // no duplicate assistant item is synthesised from finalText
    expect(state.items.filter((i) => i.kind === 'assistant')).toHaveLength(1)
  })

  it('synthesises an assistant item from finalText when no text events arrived', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        { type: 'turn.completed', ...base, finalText: '直接给结果', usage: { inputTokens: 1, outputTokens: 1 }, steps: 1, at: 2 },
      ],
      { now },
    )
    expect(state.items).toEqual([expect.objectContaining({ kind: 'assistant', text: '直接给结果', streaming: false })])
  })

  it('ignores events of other threads and keeps deltas that arrive without text.start', () => {
    const other = reduceEvents(createThreadView(threadId), [{ type: 'text.delta', threadId: 'thr_other' as ThreadId, turnId, itemId: 'x' as ItemId, delta: 'nope' }], { now })
    expect(other.items).toHaveLength(0)
    const orphan = reduceEvents(createThreadView(threadId), [{ type: 'text.delta', ...base, itemId: 'x' as ItemId, delta: 'kept' }], { now })
    expect(orphan.items[0]).toEqual(expect.objectContaining({ kind: 'assistant', text: 'kept' }))
  })

  it('marks streaming text as finished and adds a notice on turn.aborted', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        { type: 'text.start', ...base, itemId: 'a' as ItemId },
        { type: 'text.delta', ...base, itemId: 'a' as ItemId, delta: '部分' },
        toolCall({ status: 'running' }),
        { type: 'turn.aborted', ...base, reason: 'interrupted' },
      ],
      { now },
    )
    expect(state.isStreaming).toBe(false)
    const [assistant, tools, aborted] = state.items
    expect(assistant).toEqual(expect.objectContaining({ kind: 'assistant', streaming: false, text: '部分' }))
    expect(tools?.kind === 'tools' && tools.calls[0]?.status).toBe('error')
    expect(aborted).toEqual(expect.objectContaining({ kind: 'aborted', reason: 'interrupted' }))
  })
})

describe('reduceEvents — tool calls', () => {
  it('groups consecutive calls of a turn and tracks status transitions in place', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        toolCall({ status: 'pending' }),
        toolCall({ status: 'running' }),
        { type: 'tool.progress', threadId, callId: call1, message: '已扫描 40%' },
        toolCall({ callId: call2, toolName: 'read_session', summary: '读取会话', status: 'running' }),
        toolCall({ status: 'done', durationMs: 800, output: { total: 3 }, artifacts: [{ kind: 'file', title: '周报草稿.md', path: '/tmp/周报草稿.md' }] }),
      ],
      { now },
    )
    const groups = state.items.filter((i) => i.kind === 'tools')
    expect(groups).toHaveLength(1)
    const group = groups[0]
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls.map((c) => c.callId)).toEqual([call1, call2])
    const first = group.calls[0]!
    expect(first.status).toBe('done')
    expect(first.durationMs).toBe(800)
    expect(first.output).toEqual({ total: 3 })
    expect(first.progress).toBeUndefined()
    expect(group.calls[1]?.status).toBe('running')
    // artifacts become a ResultCard item after the group
    expect(state.items.at(-1)).toEqual(expect.objectContaining({ kind: 'artifact', callId: call1, artifact: expect.objectContaining({ title: '周报草稿.md' }) }))
  })

  it('does not lose the output when a later event omits it', () => {
    const state = reduceEvents(createThreadView(threadId), [toolCall({ status: 'done', output: 'ok', durationMs: 10 }), toolCall({ status: 'done' })], { now })
    const group = state.items[0]
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]?.output).toBe('ok')
    expect(group.calls[0]?.durationMs).toBe(10)
  })

  it('starts a new group after an assistant message', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [toolCall({ status: 'done', durationMs: 1 }), { type: 'text.start', ...base, itemId: 'a' as ItemId }, { type: 'text.end', ...base, itemId: 'a' as ItemId, text: '继续' }, toolCall({ callId: call2, status: 'running' })],
      { now },
    )
    expect(state.items.map((i) => i.kind)).toEqual(['tools', 'assistant', 'tools'])
  })
})

describe('reduceEvents — approvals', () => {
  const pendingSequence: Event[] = [
    { type: 'turn.started', ...base, at: 1 },
    toolCall({ toolName: 'send_message', summary: '发送消息到「投研交流群」', risk: 'send', status: 'awaiting_approval' }),
    {
      type: 'approval.requested',
      ...base,
      approvalId,
      callId: call1,
      toolName: 'send_message',
      summary: '发送消息到「投研交流群」',
      detail: '周报草稿',
      input: { to: 'g1' },
      risk: 'send',
      canAllowAlways: true,
    },
  ]

  it('anchors a pending approval to the awaiting row', () => {
    const state = reduceEvents(createThreadView(threadId), pendingSequence, { now })
    expect(state.pendingApprovals).toHaveLength(1)
    expect(state.pendingApprovals[0]).toEqual(expect.objectContaining({ approvalId, callId: call1, canAllowAlways: true, detail: '周报草稿' }))
    const group = state.items.find((i) => i.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]).toEqual(expect.objectContaining({ status: 'awaiting_approval', approvalId }))
  })

  it('creates the row when the approval arrives before its tool.call', () => {
    const [started, , requested] = pendingSequence
    const state = reduceEvents(createThreadView(threadId), [started!, requested!], { now })
    const group = state.items.find((i) => i.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]).toEqual(expect.objectContaining({ callId: call1, status: 'awaiting_approval', summary: '发送消息到「投研交流群」' }))
  })

  it('allow_once clears the approval and lets the row run to done', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [
        ...pendingSequence,
        { type: 'approval.resolved', threadId, approvalId, decision: 'allow_once' },
        toolCall({ toolName: 'send_message', risk: 'send', status: 'running' }),
        toolCall({ toolName: 'send_message', risk: 'send', status: 'done', durationMs: 600, output: { ok: true } }),
        { type: 'turn.completed', ...base, finalText: '已发送', usage: { inputTokens: 1, outputTokens: 1 }, steps: 1, at: 9 },
      ],
      { now },
    )
    expect(state.pendingApprovals).toHaveLength(0)
    const group = state.items.find((i) => i.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]).toEqual(expect.objectContaining({ status: 'done', approvalId: undefined, durationMs: 600 }))
  })

  it('deny marks the row denied immediately', () => {
    const state = reduceEvents(createThreadView(threadId), [...pendingSequence, { type: 'approval.resolved', threadId, approvalId, decision: 'deny' }], { now })
    const group = state.items.find((i) => i.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]).toEqual(expect.objectContaining({ status: 'denied', isError: true }))
    expect(state.pendingApprovals).toHaveLength(0)
  })

  it('drops pending approvals of an aborted turn', () => {
    const state = reduceEvents(createThreadView(threadId), [...pendingSequence, { type: 'turn.aborted', ...base, reason: 'interrupted' }], { now })
    expect(state.pendingApprovals).toHaveLength(0)
    const group = state.items.find((i) => i.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls[0]?.status).toBe('denied')
  })
})

describe('reduceEvents — usage, compaction, plan, errors', () => {
  it('records usage and resets the warning latch below the threshold', () => {
    const view = createThreadView(threadId, { usageWarned: true })
    const high = reduceEvents(view, [{ type: 'context.usage', threadId, usage: { usedTokens: 90, maxTokens: 100, breakdown: { system: 1, memory: 1, references: 1, history: 1, tools: 1 } } }], { now })
    expect(high.usageWarned).toBe(true)
    const low = reduceEvents(high, [{ type: 'context.usage', threadId, usage: { usedTokens: 10, maxTokens: 100, breakdown: { system: 1, memory: 1, references: 1, history: 1, tools: 1 } } }], { now })
    expect(low.usageWarned).toBe(false)
    expect(low.usage?.usedTokens).toBe(10)
  })

  it('adds a compaction notice, updates a plan in place and appends error cards', () => {
    const state = reduceEvents(
      createThreadView(threadId),
      [
        { type: 'turn.started', ...base, at: 1 },
        { type: 'plan.updated', threadId, steps: [{ title: '搜索', status: 'todo' }] },
        { type: 'plan.updated', threadId, steps: [{ title: '搜索', status: 'done' }, { title: '整理', status: 'doing' }] },
        { type: 'context.compacted', threadId, summaryItemId: 'itm_sum' as ItemId, freedTokens: 58_000 },
        { type: 'error', ...base, error: { code: 'auth', message: '401', retryable: false }, actions: [{ label: '去改 Key', action: 'open_settings_ai' }] },
      ],
      { now },
    )
    expect(state.items.map((i) => i.kind)).toEqual(['plan', 'compaction', 'error'])
    const plan = state.items[0]
    expect(plan?.kind === 'plan' && plan.steps).toEqual([{ title: '搜索', status: 'done' }, { title: '整理', status: 'doing' }])
    expect(state.items[1]).toEqual(expect.objectContaining({ kind: 'compaction', freedTokens: 58_000, summaryItemId: 'itm_sum' }))
    expect(state.items[2]).toEqual(expect.objectContaining({ kind: 'error', actions: [{ label: '去改 Key', action: 'open_settings_ai' }] }))
  })
})

describe('itemsFromHistory', () => {
  const history: HistoryItem[] = [
    { type: 'user_message', id: 'u1' as ItemId, turnId, createdAt: 1, content: [{ type: 'text', text: '找评审' }], mentions: [] },
    { type: 'assistant_message', id: 'a1' as ItemId, turnId, stepId, createdAt: 2, text: '我先搜索。', modelId: 'm1' },
    { type: 'tool_call', id: 't1' as ItemId, turnId, stepId, createdAt: 3, callId: call1, toolName: 'search_messages', input: { query: '评审' } },
    { type: 'tool_call', id: 't2' as ItemId, turnId, stepId, createdAt: 3, callId: call2, toolName: 'read_session', input: {} },
    { type: 'tool_result', id: 'r1' as ItemId, turnId, stepId, createdAt: 4, callId: call1, toolName: 'search_messages', output: { type: 'json', value: { total: 2 } }, isError: false, durationMs: 900, truncated: false },
    { type: 'context_fragment', id: 'f1' as ItemId, turnId, createdAt: 4, kind: 'memory', marker: '<m>', text: 'x', tokenEstimate: 1 },
    { type: 'assistant_message', id: 'a2' as ItemId, turnId, stepId, createdAt: 5, text: '找到 2 条。' },
    { type: 'compaction_summary', id: 'c1' as ItemId, createdAt: 6, summary: '摘要', foldedItemCount: 6, foldedThroughId: 'a2' as ItemId, tokenEstimate: 3 },
    { type: 'turn_aborted', id: 'x1' as ItemId, turnId: 'trn_2' as TurnId, createdAt: 7, reason: 'interrupted' },
  ]

  it('maps history into view items, pairing results with calls', () => {
    const items = itemsFromHistory(history)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tools', 'assistant', 'compaction', 'aborted'])
    const group = items[2]
    if (group?.kind !== 'tools') throw new Error('expected tools')
    expect(group.calls).toHaveLength(2)
    expect(group.calls[0]).toEqual(expect.objectContaining({ callId: call1, status: 'done', durationMs: 900, output: { total: 2 }, summary: 'search messages' }))
    // a call without a result never finished
    expect(group.calls[1]?.status).toBe('error')
    expect(items[4]).toEqual(expect.objectContaining({ kind: 'compaction', summary: '摘要', foldedItemCount: 6 }))
  })

  it('viewFromHistory marks the view loaded and findUserInput picks the turn input', () => {
    const view = viewFromHistory(threadId, history)
    expect(view.loaded).toBe(true)
    expect(findUserInput(view.items, turnId)?.id).toBe('u1')
    expect(findUserInput(view.items)?.id).toBe('u1')
    expect(findUserInput(view.items, 'trn_none' as TurnId)).toBeUndefined()
  })
})
