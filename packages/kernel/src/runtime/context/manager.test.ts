import { describe, expect, it } from 'vitest'
import { asCallId, asItemId, asTurnId, newItemId, newStepId, type HistoryItem, type ToolResultItem } from '@aiwc/protocol'
import { ContextManager, dropOrphans } from './manager'

const turn = asTurnId('trn_1')
const step = newStepId()
const user = (text: string): HistoryItem => ({ type: 'user_message', id: newItemId(), turnId: turn, createdAt: 1, content: [{ type: 'text', text }], mentions: [] })
const assistant = (text: string): HistoryItem => ({ type: 'assistant_message', id: newItemId(), turnId: turn, stepId: step, createdAt: 2, text })
const call = (id: string): HistoryItem => ({ type: 'tool_call', id: newItemId(), turnId: turn, stepId: step, createdAt: 3, callId: asCallId(id), toolName: 't', input: {} })
const result = (id: string, text = 'ok'): ToolResultItem => ({
  type: 'tool_result',
  id: newItemId(),
  turnId: turn,
  stepId: step,
  createdAt: 4,
  callId: asCallId(id),
  toolName: 't',
  output: { type: 'text', text },
  isError: false,
  durationMs: 1,
  truncated: false,
})

describe('ContextManager', () => {
  it('truncates tool outputs at record time with the marker', () => {
    const cm = new ContextManager([], { maxToolOutputChars: 100 })
    const [rec] = cm.recordItems([result('c1', 'x'.repeat(250))])
    expect(rec!.type).toBe('tool_result')
    if (rec!.type !== 'tool_result') return
    expect(rec!.truncated).toBe(true)
    expect(rec!.output.type === 'text' && rec!.output.text).toContain('[…truncated 150 chars]')
    expect(rec!.output.type === 'text' && rec!.output.text.length).toBeLessThan(150)
    expect(cm.version).toBe(1)
  })

  it('a per-record cap override (router-bounded outputs) skips the generic default', () => {
    const cm = new ContextManager([], { maxToolOutputChars: 100 })
    const [rec] = cm.recordItems([result('c1', 'x'.repeat(30_000))], { maxOutputChars: Number.POSITIVE_INFINITY })
    expect(rec!.type === 'tool_result' && rec!.truncated).toBe(false)
    expect(rec!.type === 'tool_result' && rec!.output.type === 'text' && rec!.output.text.length).toBe(30_000)
    const [capped] = cm.recordItems([result('c2', 'y'.repeat(500))], { maxOutputChars: 200 })
    expect(capped!.type === 'tool_result' && capped!.truncated).toBe(true)
  })

  it('json outputs over the cap become truncated text', () => {
    const cm = new ContextManager([], { maxToolOutputChars: 50 })
    const big: ToolResultItem = { ...result('c1'), output: { type: 'json', value: { rows: Array.from({ length: 40 }, (_, i) => i) } } }
    const [rec] = cm.recordItems([big])
    expect(rec!.type === 'tool_result' && rec!.output.type).toBe('text')
    expect(rec!.type === 'tool_result' && rec!.truncated).toBe(true)
  })

  it('forPrompt starts with the latest compaction summary and drops orphans', () => {
    const a = user('a')
    const b = assistant('b')
    const c1 = call('c1')
    const r1 = result('c1')
    const c2 = call('c2') // orphan: no result
    const d = user('d')
    const cm = new ContextManager([a, b, c1, r1, c2, d])
    expect(cm.forPrompt().map((i) => i.id)).toEqual([a, b, c1, r1, d].map((i) => i.id))
    cm.recordItems([{ type: 'compaction_summary', id: asItemId('sum'), createdAt: 5, summary: '摘要', foldedItemCount: 4, foldedThroughId: r1.id, tokenEstimate: 3 }])
    const visible = cm.forPrompt()
    expect(visible[0]!.type).toBe('compaction_summary')
    expect(visible.slice(1).map((i) => i.id)).toEqual([d.id])
    expect(cm.historyTokens()).toBeGreaterThan(0)
  })

  it('usage breakdown separates system/tools/memory/references/history', () => {
    const cm = new ContextManager([
      user('hello world'),
      { type: 'context_fragment', id: newItemId(), turnId: null, createdAt: 1, kind: 'memory_snapshot', marker: '<m>', text: '<m>\nmem', tokenEstimate: 7 },
      { type: 'context_fragment', id: newItemId(), turnId: null, createdAt: 1, kind: 'environment', marker: '<e>', text: '<e>\nenv', tokenEstimate: 5 },
    ])
    const usage = cm.usage({ systemTokens: 100, toolSpecTokens: 20, maxTokens: 1000 })
    expect(usage.breakdown.system).toBe(100)
    expect(usage.breakdown.tools).toBe(20)
    expect(usage.breakdown.memory).toBe(7)
    expect(usage.breakdown.references).toBe(5)
    expect(usage.breakdown.history).toBeGreaterThan(0)
    expect(usage.usedTokens).toBe(100 + 20 + 7 + 5 + usage.breakdown.history)
    expect(usage.maxTokens).toBe(1000)
  })

  it('dropLastNUserTurns removes whole turns and invalidates', () => {
    let invalidated = 0
    const cm = new ContextManager([user('1'), assistant('a1'), user('2'), assistant('a2'), user('3'), assistant('a3')], { onInvalidate: () => invalidated++ })
    const removed = cm.dropLastNUserTurns(2)
    expect(removed).toHaveLength(4)
    expect(cm.all().map((i) => (i.type === 'user_message' ? i.content[0]!.type === 'text' && i.content[0]!.text : 'a'))).toEqual(['1', 'a'])
    expect(invalidated).toBe(1)
    cm.clear()
    expect(cm.length).toBe(0)
    expect(invalidated).toBe(2)
  })

  it('dropOrphans keeps matched pairs only', () => {
    const items = [call('x'), result('x'), result('y'), call('z')]
    expect(dropOrphans(items).map((i) => (i.type === 'tool_call' || i.type === 'tool_result' ? i.callId : ''))).toEqual(['x', 'x'])
  })
})
