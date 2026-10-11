import { describe, expect, it } from 'vitest'
import { SAFE_THREAD_EXPORT, type HistoryItem } from '@aiwc/protocol'
import { renderThreadExport } from './threadExport'

const base = { turnId: 't' as never, createdAt: 0 }
const items: HistoryItem[] = [
  {
    ...base,
    type: 'user_message',
    id: 'i1' as never,
    content: [{ type: 'text', text: '帮我总结 wxid_secret01 的聊天，发到 alice@corp.cn' }],
    mentions: [],
  },
  {
    ...base,
    type: 'context_fragment',
    id: 'f1' as never,
    kind: 'memory',
    marker: 'memory',
    text: 'MEMORY SNAPSHOT',
    tokenEstimate: 3,
  },
  {
    ...base,
    type: 'tool_call',
    id: 'i2' as never,
    stepId: 's' as never,
    callId: 'c1' as never,
    toolName: 'search_messages',
    input: { sessionId: '12345@chatroom' },
  },
  {
    ...base,
    type: 'tool_result',
    id: 'i3' as never,
    stepId: 's' as never,
    callId: 'c1' as never,
    toolName: 'search_messages',
    output: { type: 'text', text: '张三：明天 13812345678 联系我' },
    isError: false,
    durationMs: 3,
    truncated: false,
  },
  {
    ...base,
    type: 'assistant_message',
    id: 'i4' as never,
    stepId: 's' as never,
    text: '好的，已总结。',
    reasoning: 'PRIVATE THOUGHTS',
  },
]

describe('renderThreadExport', () => {
  it('defaults to the privacy-safe export: no tool outputs, no reasoning, identifiers redacted', () => {
    const { content, ext } = renderThreadExport('会话', items, SAFE_THREAD_EXPORT, { now: 0, home: '/Users/x' })
    expect(ext).toBe('md')
    expect(content).toContain('## 用户')
    expect(content).toContain('好的，已总结。')
    expect(content).toContain('`search_messages`')
    for (const leaked of [
      '张三',
      '13812345678',
      'PRIVATE THOUGHTS',
      'wxid_secret01',
      'alice@corp.cn',
      '12345@chatroom',
    ])
      expect(content).not.toContain(leaked)
    expect(content).not.toContain('MEMORY SNAPSHOT')
  })

  it('includes what the user opts into, as markdown or valid JSON', () => {
    const full = { format: 'json' as const, includeToolOutputs: true, includeReasoning: true, redactIdentifiers: false }
    const { content, ext } = renderThreadExport('会话', items, full, { now: 0 })
    expect(ext).toBe('json')
    const parsed = JSON.parse(content) as { items: Array<{ type: string; output?: string; reasoning?: string }> }
    expect(parsed.items.find((i) => i.type === 'tool_result')?.output).toContain('张三')
    expect(parsed.items.find((i) => i.type === 'assistant')?.reasoning).toBe('PRIVATE THOUGHTS')
    expect(content).not.toContain('MEMORY SNAPSHOT')

    const redactedJson = renderThreadExport('会话', items, { ...full, redactIdentifiers: true }, { now: 0 })
    expect(() => JSON.parse(redactedJson.content)).not.toThrow()
    expect(redactedJson.content).not.toContain('13812345678')
  })
})
