import { describe, expect, it, vi } from 'vitest'
import type { ListMessagesQuery, WxMessage } from '@aiwc/protocol'
import {
  buildSessionExport,
  collectSessionExportMessages,
  escapeHtml,
  parseSessionExportRequest,
  safeFileName,
  sessionToMarkdown,
  threadToMarkdown,
} from './exporter'

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
    const md = sessionToMarkdown({ id: 's1', title: '测试群', kind: 'group' }, [
      msg(0),
      msg(1, { kind: 'voice', media: { kind: 'voice', durationMs: 3000, transcript: '你好' } }),
    ])
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
      {
        type: 'user_message',
        id: 'i1' as never,
        turnId: 't' as never,
        createdAt: 0,
        content: [{ type: 'text', text: '帮我' }],
        mentions: [],
      },
      {
        type: 'assistant_message',
        id: 'i2' as never,
        turnId: 't' as never,
        stepId: 's' as never,
        createdAt: 0,
        text: '好的',
      },
    ])
    expect(md).toContain('## 用户')
    expect(md).toContain('好的')
    expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(safeFileName('周报 2026-09')).toBe('周报 2026-09')
    expect(safeFileName('   ')).toBe('export')
  })
})

describe('escapeHtml', () => {
  it('escapes single quotes along with the other HTML-significant characters', () => {
    expect(escapeHtml(`<a title='x' href="y">&</a>`)).toBe(
      '&lt;a title=&#39;x&#39; href=&quot;y&quot;&gt;&amp;&lt;/a&gt;',
    )
  })
})

describe('collectSessionExportMessages', () => {
  const SENDERS = ['wxid_a', 'wxid_b', 'wxid_c'] as const
  const history = Array.from({ length: 7 }, (_, i) => msg(i + 1, { senderId: SENDERS[i % SENDERS.length] }))
  /** Pages by seq like the mirror, but ignores `senderIds` — the export must not rely on it. */
  const ignoringSenderFilter = () =>
    vi.fn(async (q: ListMessagesQuery) => {
      const after = history.filter((m) => m.seq > (q.afterSeq ?? 0))
      return { items: after.slice(0, q.limit), hasMore: after.length > q.limit }
    })

  it('keeps only the filtered senders across pages and forwards the filter to the substrate', async () => {
    const listMessages = ignoringSenderFilter()
    const out = await collectSessionExportMessages(
      listMessages,
      { sessionId: 's1', senderIds: ['wxid_a', 'wxid_c'] },
      { pageSize: 2 },
    )
    expect(out.map((m) => m.senderId)).toEqual(['wxid_a', 'wxid_c', 'wxid_a', 'wxid_c', 'wxid_a'])
    expect(listMessages).toHaveBeenCalledTimes(4)
    for (const [q] of listMessages.mock.calls) expect(q.senderIds).toEqual(['wxid_a', 'wxid_c'])
  })

  it('treats an empty sender list as everyone and intersects ticked messages with the sender filter', async () => {
    const everyone = await collectSessionExportMessages(ignoringSenderFilter(), { sessionId: 's1', senderIds: [] })
    expect(everyone).toHaveLength(history.length)
    const ticked = await collectSessionExportMessages(ignoringSenderFilter(), {
      sessionId: 's1',
      messageIds: ['m1', 'm2', 'm4'],
      senderIds: ['wxid_a'],
    })
    expect(ticked.map((m) => m.id)).toEqual(['m1', 'm4'])
  })
})

describe('parseSessionExportRequest', () => {
  it('accepts the renderer request shape', () => {
    const req = { sessionId: 's1', format: 'html', from: 1, to: 2, senderIds: ['wxid_a'], outDir: '/tmp/out' }
    expect(parseSessionExportRequest(req)).toEqual({ ok: true, request: req })
    expect(parseSessionExportRequest({ sessionId: 's1', format: 'json', messageIds: undefined })).toMatchObject({
      ok: true,
    })
  })

  it('rejects malformed filters instead of silently exporting everyone', () => {
    for (const bad of [
      { sessionId: 's1', format: 'json', senderIds: 'wxid_a' },
      { sessionId: 's1', format: 'json', senderIds: [1] },
      { sessionId: 's1', format: 'json', senderIds: [''] },
      { sessionId: 's1', format: 'pdf' },
      { sessionId: '', format: 'json' },
      { sessionId: 's1', format: 'json', extra: true },
      null,
    ]) {
      expect(parseSessionExportRequest(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})
