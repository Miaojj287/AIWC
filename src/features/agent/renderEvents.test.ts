import { describe, expect, it } from 'vitest'
import type { CallId, Event, HistoryItem, ItemId, StepId, ThreadId, TurnCheck, TurnId } from '@aiwc/protocol'
import { itemsFromHistory } from './historyItems'
import { createThreadView, type ThreadItem, type ToolCallView } from './model'
import { reduceEvent, reduceEvents } from './reducer'
import { applyChildEvent, noteSubagent, parentOfChild } from './renderEvents'
import { findSubagentRun } from './subagentLookup'

const threadId = 'thr_parent' as ThreadId
const childId = 'thr_child' as ThreadId
const turnId = 'trn_1' as TurnId
const stepId = 'stp_1' as StepId
const callId = 'cal_1' as CallId
const at = 1_700_000_000_000
const opts = { now: () => at }

const calls = (items: ThreadItem[]): ToolCallView[] => items.flatMap((it) => (it.kind === 'tools' ? it.calls : []))

const toolCall = (over: Partial<Extract<Event, { type: 'tool.call' }>> = {}): Event => ({
  type: 'tool.call',
  threadId,
  turnId,
  stepId,
  callId,
  toolName: 'search_messages',
  summary: '搜索「周报」',
  input: { query: '周报' },
  status: 'pending',
  risk: 'read',
  startedAt: at,
  ...over,
})

const input = (delta: string): Event => ({
  type: 'tool.input',
  threadId,
  turnId,
  callId,
  toolName: 'search_messages',
  delta,
})

describe('tool arguments while the model writes them', () => {
  it('shows the row early, fills its input in, and lets the finished call replace it', () => {
    let view = reduceEvents(createThreadView(threadId), [input('{"query": "周'), input('报", "sessionIds": ["a')], opts)
    expect(calls(view.items)).toMatchObject([
      {
        callId,
        status: 'pending',
        input: { query: '周报', sessionIds: ['a'] },
        inputText: '{"query": "周报", "sessionIds": ["a',
      },
    ])
    view = reduceEvent(view, toolCall({ input: { query: '周报' } }), opts)
    const [row] = calls(view.items)
    expect(row?.input).toEqual({ query: '周报' })
    expect(row?.inputText).toBeUndefined()
    // a late delta does not reopen a finished input
    view = reduceEvent(view, input('x'), opts)
    expect(calls(view.items)[0]?.inputText).toBeUndefined()
  })

  it('drops rows still being written when the request is retried', () => {
    const view = reduceEvents(
      createThreadView(threadId),
      [input('{"q'), { type: 'stream.retrying', threadId, turnId, attempt: 1, max: 3, reason: 'network', delayMs: 0 }],
      opts,
    )
    expect(calls(view.items)).toEqual([])
  })
})

describe('automatic checks', () => {
  const check: TurnCheck = { kind: 'citations', checked: 3, failed: 0, issues: [], action: 'none' }

  it('adds a check row live and after a reload', () => {
    const live = reduceEvent(
      createThreadView(threadId),
      { type: 'turn.check', threadId, turnId, itemId: 'itm_c' as ItemId, check },
      opts,
    )
    expect(live.items).toEqual([{ kind: 'check', id: 'itm_c', turnId, check }])
    const history: HistoryItem[] = [
      { type: 'turn_check', id: 'itm_c' as ItemId, turnId, createdAt: at, check },
      // a report of an unknown shape only loses its row
      { type: 'turn_check', id: 'itm_d' as ItemId, turnId, createdAt: at, check: { kind: 'nope' } as never },
    ]
    expect(itemsFromHistory(history)).toEqual([{ kind: 'check', id: 'itm_c', turnId, check }])
  })
})

describe('plan card from update_plan', () => {
  const steps = [
    { title: '读取', status: 'done' },
    { title: '总结', status: 'doing' },
  ]

  it('draws the plan from the call input and updates it in place', () => {
    let view = reduceEvent(createThreadView(threadId), toolCall({ toolName: 'update_plan', input: { steps } }), opts)
    expect(view.items.find((it) => it.kind === 'plan')).toMatchObject({ steps })
    const next = [
      { title: '读取', status: 'done' },
      { title: '总结', status: 'done' },
    ]
    view = reduceEvent(
      view,
      toolCall({ callId: 'cal_2' as CallId, toolName: 'update_plan', input: { steps: next } }),
      opts,
    )
    expect(view.items.filter((it) => it.kind === 'plan')).toHaveLength(1)
    expect(view.items.find((it) => it.kind === 'plan')).toMatchObject({ steps: next })
  })

  it('rebuilds the same plan from history', () => {
    const history: HistoryItem[] = [
      {
        type: 'tool_call',
        id: 'itm_1' as ItemId,
        turnId,
        stepId,
        createdAt: at,
        callId,
        toolName: 'update_plan',
        input: { steps },
      },
    ]
    expect(itemsFromHistory(history).find((it) => it.kind === 'plan')).toMatchObject({ steps })
  })
})

describe('sub-agents under their tool row', () => {
  const started: Event = { type: 'subagent', threadId, childId, status: 'started', label: '查群聊', callId }

  it('attaches the child to the calling row, folds its events in, and finds it for the log tab', () => {
    let view = reduceEvents(
      createThreadView(threadId),
      [
        toolCall({
          toolName: 'delegate_analysis',
          status: 'running',
          input: { tasks: [{ title: '查群聊', prompt: 'x' }] },
        }),
        started,
      ],
      opts,
    )
    expect(calls(view.items)[0]?.children).toMatchObject([{ childId, label: '查群聊', status: 'running', items: [] }])

    // the store routes the child's own events to its parent (agentEvents.ts)
    noteSubagent(started as Extract<Event, { type: 'subagent' }>)
    expect(parentOfChild(childId)).toBe(threadId)
    const childTurn = 'trn_child' as TurnId
    const childEvents: Event[] = [
      { type: 'turn.started', threadId: childId, turnId: childTurn, at },
      { ...toolCall({ threadId: childId, turnId: childTurn, callId: 'cal_c' as CallId }) },
      { type: 'text.start', threadId: childId, turnId: childTurn, itemId: 'itm_t' as ItemId },
      { type: 'text.end', threadId: childId, turnId: childTurn, itemId: 'itm_t' as ItemId, text: '结论' },
    ]
    for (const e of childEvents) view = { ...view, items: applyChildEvent(view.items, childId, e, reduceEvent) }
    const run = calls(view.items)[0]?.children?.[0]
    expect(run?.items.map((it) => it.kind)).toEqual(['tools', 'assistant'])
    expect(findSubagentRun({ [threadId]: view }, childId)).toMatchObject({ threadId, run: { childId } })

    const done: Event = { ...started, status: 'done' }
    view = reduceEvent(view, done, opts)
    noteSubagent(done as Extract<Event, { type: 'subagent' }>)
    expect(calls(view.items)[0]?.children?.[0]?.status).toBe('done')
    expect(parentOfChild(childId)).toBeUndefined()
  })

  it('keeps a child without a known parent call as a row of its own (older events)', () => {
    const view = reduceEvent(
      createThreadView(threadId, { currentTurnId: turnId }),
      { ...started, callId: undefined },
      opts,
    )
    expect(calls(view.items)).toMatchObject([{ kind: 'subagent', summary: '查群聊' }])
  })

  it('shows the recorded traces after a reload (and from the final event)', () => {
    const trace = {
      childId,
      label: '查群聊',
      status: 'done' as const,
      startedAt: at,
      durationMs: 1200,
      items: [
        { type: 'assistant_message', id: 'itm_a', turnId: 'trn_c', stepId, createdAt: at, text: '结论' },
      ] as HistoryItem[],
      omitted: 2,
    }
    const history: HistoryItem[] = [
      {
        type: 'tool_call',
        id: 'itm_1' as ItemId,
        turnId,
        stepId,
        createdAt: at,
        callId,
        toolName: 'delegate_analysis',
        input: {},
      },
      {
        type: 'tool_result',
        id: 'itm_2' as ItemId,
        turnId,
        stepId,
        createdAt: at,
        callId,
        toolName: 'delegate_analysis',
        output: { type: 'text', text: 'ok' },
        isError: false,
        durationMs: 1300,
        truncated: false,
        subagents: [trace, { junk: true } as never],
      },
    ]
    const [run] = calls(itemsFromHistory(history))[0]?.children ?? []
    expect(run).toMatchObject({ childId, status: 'done', omitted: 2, durationMs: 1200 })
    expect(run?.items).toMatchObject([{ kind: 'assistant', text: '结论' }])

    const live = reduceEvent(
      createThreadView(threadId),
      toolCall({ toolName: 'delegate_analysis', status: 'done', subagents: [trace] }),
      opts,
    )
    expect(calls(live.items)[0]?.children?.[0]).toMatchObject({ childId, status: 'done' })
  })
})
