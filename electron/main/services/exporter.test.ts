import { describe, expect, it } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { buildSessionExport, safeFileName, sessionToMarkdown, threadToMarkdown } from './exporter'

const msg = (i: number, extra: Partial<WxMessage> = {}): WxMessage => ({
  id: `m${i}`,
  sessionId: 's1',
  seq: i,
  createdAt: Date.UTC(2026, 8, 6, 2, 0, i),
  senderId: i % 2 ? 'me' : 'peer',
  senderName: i % 2 ? undefined : '对方',
  isSelf: i % 2 === 1,
  kind: 'text',
  text: `hello ${i} <b>`,
  anchor: { sessionId: 's1', messageId: `m${i}`, seq: i, createdAt: 0 },
  ...extra,
})

describe('exporter', () => {
  it('renders markdown with day headings and speaker labels', () => {
    const md = sessionToMarkdown({ id: 's1', title: '测试群', kind: 'group' }, [msg(0), msg(1, { kind: 'voice', media: { kind: 'voice', durationMs: 3000, transcript: '你好' } })])
    expect(md).toContain('# 测试群')
    expect(md).toContain('**对方**')
    expect(md).toContain('**我**')
    expect(md).toContain('[语音 3s] 你好')
  })

  it('escapes html and picks an extension per format', () => {
    const { content, ext } = buildSessionExport('html', { id: 's1', title: 'x', kind: 'dm' }, [msg(0)])
    expect(ext).toBe('html')
    expect(content).toContain('hello 0 &lt;b&gt;')
    expect(buildSessionExport('excel', { id: 's1', title: 'x', kind: 'dm' }, [msg(0)]).ext).toBe('csv')
    expect(JSON.parse(buildSessionExport('json', { id: 's1', title: 'x', kind: 'dm' }, [msg(0)]).content).count).toBe(1)
  })

  it('renders agent threads and sanitises file names', () => {
    const md = threadToMarkdown('会话', [
      { type: 'user_message', id: 'i1' as never, turnId: 't' as never, createdAt: 0, content: [{ type: 'text', text: '帮我' }], mentions: [] },
      { type: 'assistant_message', id: 'i2' as never, turnId: 't' as never, stepId: 's' as never, createdAt: 0, text: '好的' },
    ])
    expect(md).toContain('## 用户')
    expect(md).toContain('好的')
    expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(safeFileName('周报 2026-09')).toBe('周报 2026-09')
    expect(safeFileName('   ')).toBe('export')
  })
})
