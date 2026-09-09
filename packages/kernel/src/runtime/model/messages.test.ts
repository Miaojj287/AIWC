import { describe, expect, it } from 'vitest'
import { asCallId, asTurnId, newItemId, newStepId, type HistoryItem } from '@aiwc/protocol'
import { historyToModelMessages } from './messages'

describe('historyToModelMessages', () => {
  it('(11) round-trips tool call / result pairing and merges user-role material', () => {
    const turn = asTurnId('t')
    const step = newStepId()
    const items: HistoryItem[] = [
      { type: 'context_fragment', id: newItemId(), turnId: null, createdAt: 1, kind: 'environment', marker: '<environment>', text: '<environment>\n平台：darwin', tokenEstimate: 5 },
      { type: 'user_message', id: newItemId(), turnId: turn, createdAt: 2, content: [{ type: 'text', text: '查一下' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }], mentions: [] },
      { type: 'assistant_message', id: newItemId(), turnId: turn, stepId: step, createdAt: 3, text: '我来查。' },
      { type: 'tool_call', id: newItemId(), turnId: turn, stepId: step, createdAt: 4, callId: asCallId('c1'), toolName: 'search', input: { q: 'a' } },
      { type: 'tool_call', id: newItemId(), turnId: turn, stepId: step, createdAt: 4, callId: asCallId('c2'), toolName: 'search', input: { q: 'b' } },
      { type: 'tool_result', id: newItemId(), turnId: turn, stepId: step, createdAt: 5, callId: asCallId('c1'), toolName: 'search', output: { type: 'json', value: { hits: 1 } }, isError: false, durationMs: 1, truncated: false },
      { type: 'tool_result', id: newItemId(), turnId: turn, stepId: step, createdAt: 5, callId: asCallId('c2'), toolName: 'search', output: { type: 'text', text: 'boom' }, isError: true, durationMs: 1, truncated: false },
      { type: 'assistant_message', id: newItemId(), turnId: turn, stepId: newStepId(), createdAt: 6, text: '结果如下。' },
    ]
    const msgs = historyToModelMessages(items)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])

    const user = msgs[0]!
    expect(Array.isArray(user.content) && user.content.map((p) => p.type)).toEqual(['text', 'text', 'image'])

    const assistant = msgs[1]!
    const aParts = assistant.content as Array<{ type: string; toolCallId?: string; toolName?: string; input?: unknown }>
    expect(aParts.map((p) => p.type)).toEqual(['text', 'tool-call', 'tool-call'])
    const callIds = aParts.filter((p) => p.type === 'tool-call').map((p) => p.toolCallId)
    expect(callIds).toEqual(['c1', 'c2'])

    const tool = msgs[2]!
    const tParts = tool.content as Array<{ type: string; toolCallId: string; output: { type: string; value?: unknown } }>
    expect(tParts.map((p) => p.toolCallId)).toEqual(callIds)
    expect(tParts[0]!.output).toEqual({ type: 'json', value: { hits: 1 } })
    expect(tParts[1]!.output).toEqual({ type: 'error-text', value: 'boom' })
  })

  it('drops results whose call is unknown and renders summaries / aborts as user text', () => {
    const turn = asTurnId('t')
    const items: HistoryItem[] = [
      { type: 'compaction_summary', id: newItemId(), createdAt: 1, summary: '早前摘要', foldedItemCount: 3, foldedThroughId: newItemId(), tokenEstimate: 4 },
      { type: 'tool_result', id: newItemId(), turnId: turn, stepId: newStepId(), createdAt: 2, callId: asCallId('zz'), toolName: 'x', output: { type: 'text', text: 'orphan' }, isError: false, durationMs: 1, truncated: false },
      { type: 'turn_aborted', id: newItemId(), turnId: turn, createdAt: 3, reason: 'interrupted' },
      { type: 'user_message', id: newItemId(), turnId: turn, createdAt: 4, content: [{ type: 'text', text: '继续' }], mentions: [] },
    ]
    const msgs = historyToModelMessages(items)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.role).toBe('user')
    const texts = (msgs[0]!.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? '')
    expect(texts[0]).toContain('早前摘要')
    expect(texts[1]).toContain('中断')
    expect(texts[2]).toBe('继续')
    expect(JSON.stringify(msgs)).not.toContain('orphan')
  })
})
