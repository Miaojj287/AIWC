import { describe, expect, it, vi } from 'vitest'
import {
  asCallId,
  asThreadId,
  asTurnId,
  SUBAGENT_TRACE_MAX_ITEMS,
  SUBAGENT_TRACE_OUTPUT_CHARS,
  type ApprovalId,
  type Event,
  type HistoryItem,
  type ItemId,
  type StepId,
  type TurnCheck,
} from '@aiwc/protocol'
import { buildSubagentTrace, SUBAGENT_TRACE_MAX_BYTES, watchApprovalWaits } from './childRun'
import { historyToModelMessages } from './model/messages'
import { createMockModelClient } from './model/mock'
import { createThreadHarness, userInput } from './testing/harness'
import { createToolInputStream, TOOL_INPUT_FLUSH_MS } from './toolInputStream'
import { runWorkflow } from './workflowEngine'

const threadId = asThreadId('thr_1')
const turnId = asTurnId('trn_1')
const stepId = 'stp_1' as StepId
const check = (failed: number): TurnCheck => ({ kind: 'citations', checked: 2, failed, issues: [], action: 'none' })

describe('automatic checks reported by a Stop hook', () => {
  it('records each check in the turn with what the turn did about it, for the transcript only', async () => {
    const model = createMockModelClient([{ text: '草稿' }, { text: '改好的答复' }])
    const h = await createThreadHarness({ model })
    let audits = 0
    h.services.hooks.add({
      name: 'audit',
      events: ['Stop'],
      async run() {
        audits++
        return audits === 1 ? { block: { reason: '有一处引用不符' }, checks: [check(1)] } : { checks: [check(0)] }
      },
    })
    const result = await (await h.thread.startTurn(userInput('问'), 'start')).promise
    expect(result).toMatchObject({ status: 'completed', text: '改好的答复' })
    const recorded = h.thread.context.all().filter((i) => i.type === 'turn_check')
    expect(recorded.map((i) => i.type === 'turn_check' && i.check.action)).toEqual(['rewrite', 'none'])
    const events = h.events.events.filter((e) => e.type === 'turn.check')
    expect(events.map((e) => e.type === 'turn.check' && e.check.failed)).toEqual([1, 0])
    // the model never sees the report (what it must fix arrives as the stop_hook fragment)
    expect(JSON.stringify(historyToModelMessages(h.thread.context.all()))).not.toContain('citations')
  })

  it('keeps the issues when no rewrite is left', async () => {
    const model = createMockModelClient({ steps: [{ text: '答复' }], loopLast: true })
    const h = await createThreadHarness({ model, config: { maxStepsPerTurn: 1 } })
    h.services.hooks.add({
      name: 'audit',
      events: ['Stop'],
      run: async () => ({ block: { reason: 'x' }, checks: [check(1)] }),
    })
    await (
      await h.thread.startTurn(userInput('问'), 'start')
    ).promise
    const [item] = h.thread.context.all().filter((i) => i.type === 'turn_check')
    expect(item?.type === 'turn_check' && item.check.action).toBe('kept')
  })
})

describe('tool arguments streamed while the model writes them', () => {
  it('sends tool.input deltas before the call, and records what the tool describes with the call', async () => {
    const input = { query: '周报和评审', sessionIds: ['a', 'b'] }
    const model = createMockModelClient([
      { toolCalls: [{ name: 'find', input, callId: 'cal_s', streamInput: true }] },
      { text: '好了' },
    ])
    const h = await createThreadHarness({
      model,
      tools: [
        {
          name: 'find',
          describe: () => ({ code: 'find', params: { scope: 'all' } }),
          execute: async () => ({ content: 'ok' }),
        },
      ],
    })
    await (
      await h.thread.startTurn(userInput('找'), 'start')
    ).promise
    const kinds = h.events.events.filter((e) => e.type === 'tool.input' || e.type === 'tool.call').map((e) => e.type)
    expect(kinds[0]).toBe('tool.input')
    expect(kinds.indexOf('tool.call')).toBeGreaterThan(0)
    const text = h.events.events.map((e) => (e.type === 'tool.input' ? e.delta : '')).join('')
    expect(JSON.parse(text)).toEqual(input)
    const call = h.thread.context.all().find((i) => i.type === 'tool_call')
    expect(call?.type === 'tool_call' && call.display).toEqual({ code: 'find', params: { scope: 'all' } })
  })

  it('sends the first delta at once and batches the rest per flush interval', () => {
    let now = 0
    const events: Event[] = []
    const stream = createToolInputStream({ emit: (e) => events.push(e), threadId, turnId, clock: () => now })
    const id = asCallId('cal_1')
    stream.push(id, 'find', '{"q')
    stream.push(id, 'find', '":"a')
    now += TOOL_INPUT_FLUSH_MS - 1
    stream.push(id, 'find', 'b')
    expect(events).toHaveLength(1)
    now += 1
    stream.push(id, 'find', 'c')
    expect(events).toHaveLength(2)
    stream.push(id, 'find', '"}')
    stream.flush(id)
    expect(events.map((e) => (e.type === 'tool.input' ? e.delta : '')).join('')).toBe('{"q":"abc"}')
  })
})

describe('sub-agent traces', () => {
  const at = 1_700_000_000_000
  const item = (i: number, chars = SUBAGENT_TRACE_OUTPUT_CHARS + 10): HistoryItem => ({
    type: 'tool_result',
    id: `itm_${i}` as ItemId,
    turnId,
    stepId,
    createdAt: at,
    callId: asCallId(`cal_${i}`),
    toolName: 'read',
    output: { type: 'text', text: 'x'.repeat(chars) },
    isError: false,
    durationMs: 1,
    truncated: false,
  })

  it('keeps the child work (not its prompt), bounded and with outputs shortened', () => {
    const prompt: HistoryItem = {
      type: 'user_message',
      id: 'itm_u' as ItemId,
      turnId,
      createdAt: at,
      content: [{ type: 'text', text: '任务' }],
      mentions: [],
    }
    const meta = { childId: 'thr_c', label: 'L', status: 'done' as const, startedAt: at, durationMs: 5 }
    const items = [prompt, ...Array.from({ length: SUBAGENT_TRACE_MAX_ITEMS + 3 }, (_, i) => item(i, 10))]
    const trace = buildSubagentTrace(items, meta)
    expect(trace.items).toHaveLength(SUBAGENT_TRACE_MAX_ITEMS)
    expect(trace.omitted).toBe(3)
    expect(trace.items.some((i) => i.type === 'user_message')).toBe(false)
    const long = buildSubagentTrace([item(0)], meta).items[0]
    expect(long?.type === 'tool_result' && long.output.type === 'text' && long.output.text.length).toBe(
      SUBAGENT_TRACE_OUTPUT_CHARS + 1,
    )
  })

  it('caps reply text, reasoning and tool arguments per item and the whole trace in bytes', () => {
    const meta = { childId: 'thr_c', label: 'L', status: 'done' as const, startedAt: at, durationMs: 5 }
    const reply: HistoryItem = {
      type: 'assistant_message',
      id: 'itm_a' as ItemId,
      turnId,
      stepId,
      createdAt: at,
      text: '长'.repeat(50_000),
      reasoning: '想'.repeat(50_000),
    }
    const call: HistoryItem = {
      type: 'tool_call',
      id: 'itm_c' as ItemId,
      turnId,
      stepId,
      createdAt: at,
      callId: asCallId('cal_big'),
      toolName: 'write',
      input: { content: 'y'.repeat(50_000) },
    }
    const many = Array.from({ length: SUBAGENT_TRACE_MAX_ITEMS - 2 }, (_, i) => item(i))
    const trace = buildSubagentTrace([reply, call, ...many], meta)
    expect(new TextEncoder().encode(JSON.stringify(trace)).length).toBeLessThanOrEqual(SUBAGENT_TRACE_MAX_BYTES)
    expect(trace.omitted).toBeGreaterThan(0)
    const small = buildSubagentTrace([reply, call], meta)
    const [a, c] = small.items
    expect(a?.type === 'assistant_message' && a.text.length < 5000 && (a.reasoning ?? '').length < 5000).toBe(true)
    expect(c?.type === 'tool_call' && JSON.stringify(c.input).length < SUBAGENT_TRACE_OUTPUT_CHARS + 10).toBe(true)
  })

  it('holds the parent clocks while a child approval waits, and lets go when the child ends', () => {
    const passed: Event[] = []
    const resumed = vi.fn()
    const onWait = vi.fn(() => resumed)
    const waits = watchApprovalWaits((e) => passed.push(e), 'thr_c', onWait)
    const requested = (approvalId: string): Event => ({
      type: 'approval.requested',
      threadId: asThreadId('thr_c'),
      turnId,
      approvalId: approvalId as ApprovalId,
      callId: asCallId('cal_1'),
      toolName: 'write',
      summary: 's',
      input: null,
      risk: 'write',
      canAllowAlways: true,
    })
    waits.emit(requested('apr_1'))
    waits.emit(requested('apr_2'))
    waits.emit({
      type: 'approval.resolved',
      threadId: asThreadId('thr_c'),
      approvalId: 'apr_1' as ApprovalId,
      decision: 'allow_once',
    })
    expect(onWait).toHaveBeenCalledTimes(2)
    expect(resumed).toHaveBeenCalledTimes(1)
    waits.stop()
    expect(resumed).toHaveBeenCalledTimes(2)
    expect(passed).toHaveLength(3)
  })
})

describe('workflow step limits', () => {
  it('stop counting while the step waits for the user', async () => {
    vi.useFakeTimers()
    try {
      let answer: () => void = () => {}
      const states = runWorkflow(
        {
          title: 'T',
          maxConcurrency: 1,
          steps: [{ id: 'a', title: 'A', prompt: 'p', dependsOn: [], mode: 'write', output: 'text' }],
        },
        {
          stepTimeoutMs: 50,
          signal: new AbortController().signal,
          runStep: (_s, _i, _signal, pauseClock) =>
            new Promise<string>((resolve) => {
              const resume = pauseClock()
              answer = () => {
                resume()
                resolve('done')
              }
            }),
        },
      )
      await vi.advanceTimersByTimeAsync(10_000)
      answer()
      expect((await states).get('a')).toMatchObject({ status: 'done' })
    } finally {
      vi.useRealTimers()
    }
  })
})
