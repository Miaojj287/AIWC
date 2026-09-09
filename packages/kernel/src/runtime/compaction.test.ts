import { describe, expect, it } from 'vitest'
import { asTurnId, newItemId, newStepId, type HistoryItem } from '@aiwc/protocol'
import { selectCompactionSplit, shouldCompact } from './compaction'
import { createMockModelClient } from './model/mock'
import { createThreadHarness, userInput } from './testing/harness'

const longText = (seed: string): string => `${seed}：这是一段相当长的对话内容，用来把上下文占用推高，包含会话 sess_${seed} 与消息 msg_${seed} 作为证据锚点。`.repeat(3)

function seedHistory(turns: number): HistoryItem[] {
  const items: HistoryItem[] = []
  for (let i = 0; i < turns; i++) {
    const turnId = asTurnId(`trn_${i}`)
    items.push({ type: 'user_message', id: newItemId(), turnId, createdAt: i * 10, content: [{ type: 'text', text: longText(`u${i}`) }], mentions: [] })
    items.push({ type: 'assistant_message', id: newItemId(), turnId, stepId: newStepId(), createdAt: i * 10 + 1, text: longText(`a${i}`) })
  }
  return items
}

describe('compaction', () => {
  it('shouldCompact compares against threshold × window', () => {
    expect(shouldCompact({ usedTokens: 81, maxTokens: 100, breakdown: { system: 0, memory: 0, references: 0, history: 81, tools: 0 } }, 0.8)).toBe(true)
    expect(shouldCompact({ usedTokens: 80, maxTokens: 100, breakdown: { system: 0, memory: 0, references: 0, history: 80, tools: 0 } }, 0.8)).toBe(false)
  })

  it('selectCompactionSplit keeps the last user turn(s) within 30% of the window', () => {
    const items = seedHistory(6)
    const split = selectCompactionSplit(items, () => 10, 100) // budget 30 tokens → one turn (20) fits, two (40) do not
    expect(split?.tail.map((i) => i.type)).toEqual(['user_message', 'assistant_message'])
    expect(split?.prefix).toHaveLength(10)
    const wide = selectCompactionSplit(items, () => 10, 1000) // everything fits → nothing to fold
    expect(wide).toBeUndefined()
  })

  it('(7) triggers before the turn, records a summary and forPrompt() starts with it', async () => {
    const model = createMockModelClient({ steps: [{ text: '继续。' }], ref: { contextWindow: 600 }, loopLast: true })
    const aux = createMockModelClient({ steps: [{ text: '摘要：用户此前讨论了 sess_u0 与 msg_a1 等内容。' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux, config: { compactionThreshold: 0.5 } })
    h.thread.context.recordItems(seedHistory(6))
    const before = h.thread.context.historyTokens()
    expect(before).toBeGreaterThan(300)

    const result = await (await h.thread.startTurn(userInput('接着说'), 'start')).promise
    expect(result.status).toBe('completed')
    const compacted = h.events.events.find((e) => e.type === 'context.compacted')
    expect(compacted).toBeDefined()
    expect(compacted && compacted.type === 'context.compacted' && compacted.freedTokens).toBeGreaterThan(0)

    const summaries = h.thread.context.all().filter((i) => i.type === 'compaction_summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.summary).toContain('sess_u0')
    const visible = h.thread.context.forPrompt()
    expect(visible[0]!.type).toBe('compaction_summary')
    expect(visible.some((i) => i.type === 'user_message' && i.content[0]!.type === 'text' && i.content[0]!.text === '接着说')).toBe(true)
    expect(h.thread.context.historyTokens()).toBeLessThan(before)
    expect(h.services.rollout.linesOf(h.thread.id).some((l) => l.type === 'compacted')).toBe(true)
    expect(h.services.hooks.calls.map((c) => c.event)).toEqual(expect.arrayContaining(['PreCompact', 'PostCompact']))
    // the model saw the summary first
    const req = model.requests[0]!
    expect(req.history[0]!.type).toBe('compaction_summary')
    expect(aux.requests[0]!.system).toContain('证据锚点')
  })

  it('manual thread.compact uses the same path', async () => {
    const model = createMockModelClient({ steps: [{ text: '。' }], ref: { contextWindow: 600 }, loopLast: true })
    const aux = createMockModelClient({ steps: [{ text: '手动摘要。' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    h.thread.context.recordItems(seedHistory(4))
    await h.thread.submit({ type: 'thread.compact', threadId: h.thread.id })
    expect(h.thread.context.forPrompt()[0]).toMatchObject({ type: 'compaction_summary', summary: '手动摘要。' })
    expect(h.events.types()).toContain('context.compacted')
  })
})
