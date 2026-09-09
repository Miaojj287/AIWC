import { describe, expect, it } from 'vitest'
import { getContext } from './getContext'
import { getTimeline } from './getTimeline'
import { searchMessages, semanticSearch } from './search'
import { searchMedia } from './searchMedia'
import { body, runTool } from './testing/ctx'
import { T0, sampleWorld } from './testing/fakeSubstrate'

describe('search_messages', () => {
  it('returns anchored hits, coverage and UI anchors meta', async () => {
    const sub = sampleWorld()
    const res = await runTool(searchMessages, { query: '火锅' }, sub)
    expect(res.isError).toBeUndefined()
    const out = body(res)
    expect(out.mode).toBe('keyword')
    expect(out.hits).toHaveLength(2)
    expect(out.hits[0]).toMatchObject({ sender: '阿明', isSelf: false, kind: 'text', source: 'fts' })
    expect(out.hits[0].anchor).toEqual({ sessionId: 'user_a', messageId: 'm6', seq: 6, createdAt: T0 + 6 * 60_000 })
    expect(out.hits[0].snippet).toContain('火锅')
    expect(out.coverage.scope).toBe('all_indexed')
    expect(out.coverage.bounded).toBe(true)
    expect(res.meta?.anchors).toHaveLength(2)
    expect(sub.calls[0]).toEqual({ method: 'search', args: [{ query: '火锅', limit: 10, mode: 'keyword' }] })
  })
  it('scopes to sessionIds and time range', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(searchMessages, { query: '周报', sessionIds: ['grp_1@chatroom'], from: T0, to: T0 + 60_000, limit: 5 }, sub))
    expect(sub.calls[0]?.args[0]).toEqual({ query: '周报', sessionIds: ['grp_1@chatroom'], from: T0, to: T0 + 60_000, limit: 5, mode: 'keyword' })
    expect(out.hits.map((h: { anchor: { messageId: string } }) => h.anchor.messageId)).toEqual(['g1'])
    expect(out.coverage).toMatchObject({ scope: 'sessions', sessionCount: 1, bounded: false })
    expect(body(await runTool(searchMessages, { query: 'nothing-here' }, sub)).note).toBeDefined()
  })
  it('validates query, limit, from<=to and sessionIds', () => {
    const s = searchMessages.inputSchema
    expect(s.safeParse({}).success).toBe(false)
    expect(s.safeParse({ query: ' ' }).success).toBe(false)
    expect(s.safeParse({ query: 'a', limit: 51 }).success).toBe(false)
    expect(s.safeParse({ query: 'a', from: 10, to: 1 }).success).toBe(false)
    expect(s.safeParse({ query: 'a', sessionIds: [] }).success).toBe(false)
    expect(s.safeParse({ query: 'a', sessionIds: ['x'], limit: 50 }).success).toBe(true)
  })
  it('surfaces substrate failures as isError', async () => {
    const sub = sampleWorld()
    sub.search = async () => {
      throw new Error('index locked')
    }
    const res = await runTool(searchMessages, { query: 'x' }, sub)
    expect(res.isError).toBe(true)
    expect(body(res).error).toContain('index locked')
  })
})

describe('semantic_search', () => {
  it('always asks the substrate for hybrid mode and caps at 20', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(semanticSearch, { query: '吃饭 火锅', sessionIds: ['user_a'] }, sub))
    expect(sub.calls[0]).toEqual({ method: 'search', args: [{ query: '吃饭 火锅', sessionIds: ['user_a'], limit: 8, mode: 'hybrid' }] })
    expect(out.mode).toBe('hybrid')
    expect(out.hits[0].source).toBe('fused')
    expect(out.matchedBy).toEqual(['fused'])
    expect(out.hits[0].anchor.sessionId).toBe('user_a')
    expect(semanticSearch.inputSchema.safeParse({ query: 'a', limit: 21 }).success).toBe(false)
    expect(semanticSearch.inputSchema.safeParse({ query: 'a', limit: 20 }).success).toBe(true)
  })
})

describe('get_context', () => {
  it('returns ordered compact messages around the anchor and flags it', async () => {
    const sub = sampleWorld()
    const anchor = { sessionId: 'user_a', messageId: 'm3', seq: 3, createdAt: T0 + 3 * 60_000 }
    const res = await runTool(getContext, { anchor, radius: 2 }, sub)
    const out = body(res)
    expect(sub.calls[0]).toEqual({ method: 'getContext', args: [anchor, 2] })
    expect(out.messages.map((m: { anchor: { messageId: string } }) => m.anchor.messageId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(out.messages[2]).toMatchObject({ isAnchor: true, kind: 'voice', text: '[语音 4s]', senderName: '阿明' })
    expect(out.messages[1]).toMatchObject({ senderName: '我', isSelf: true })
    expect(out.messages[0].isAnchor).toBeUndefined()
    expect(res.meta?.anchors).toHaveLength(5)
  })
  it('errors when the anchor cannot be resolved', async () => {
    const sub = sampleWorld()
    const res = await runTool(getContext, { anchor: { sessionId: 'user_a', messageId: 'nope', seq: 99, createdAt: 1 } }, sub)
    expect(res.isError).toBe(true)
    expect(body(res).error).toContain('锚点')
  })
  it('requires a full anchor and radius <= 30', () => {
    const s = getContext.inputSchema
    expect(s.safeParse({ anchor: { sessionId: 'a', messageId: 'b' } }).success).toBe(false)
    expect(s.safeParse({ anchor: { sessionId: 'a', messageId: 'b', seq: 1, createdAt: 1 }, radius: 31 }).success).toBe(false)
    expect(s.safeParse({ anchor: { sessionId: 'a', messageId: 'b', seq: 1, createdAt: 1 } }).success).toBe(true)
  })
})

describe('get_timeline', () => {
  it('reads a window oldest-first regardless of substrate order', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(getTimeline, { sessionId: 'user_a', from: T0 + 2 * 60_000, to: T0 + 5 * 60_000, limit: 10 }, sub))
    expect(sub.calls[0]).toEqual({ method: 'listMessages', args: [{ sessionId: 'user_a', limit: 10, from: T0 + 2 * 60_000, to: T0 + 5 * 60_000 }] })
    expect(out.messages.map((m: { anchor: { messageId: string } }) => m.anchor.messageId)).toEqual(['m2', 'm3', 'm4', 'm5'])
    expect(out.count).toBe(4)
    expect(out.hasMore).toBe(false)
    expect(out.covered.from).toMatch(/^\d{4}-/)
    expect(out.messages[3].text).toBe('[文件] 预算.xlsx')
  })
  it('takes the most recent slice when no range is given and reports hasMore', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(getTimeline, { sessionId: 'user_a', limit: 2 }, sub))
    expect(out.messages.map((m: { anchor: { messageId: string } }) => m.anchor.messageId)).toEqual(['m5', 'm6'])
    expect(out.hasMore).toBe(true)
    expect(out.window).toEqual({ from: null, to: null })
  })
  it('validates sessionId, limit <= 200 and from <= to', () => {
    const s = getTimeline.inputSchema
    expect(s.safeParse({}).success).toBe(false)
    expect(s.safeParse({ sessionId: 'a', limit: 201 }).success).toBe(false)
    expect(s.safeParse({ sessionId: 'a', from: 2, to: 1 }).success).toBe(false)
    expect(s.safeParse({ sessionId: 'a', limit: 200 }).success).toBe(true)
  })
})

describe('search_media', () => {
  it('finds media in one session via kind filters, returning anchors + file names only', async () => {
    const sub = sampleWorld()
    const res = await runTool(searchMedia, { sessionId: 'user_a', kind: 'file' }, sub)
    const out = body(res)
    expect(sub.calls[0]?.method).toBe('listMessages')
    expect(sub.calls[0]?.args[0]).toMatchObject({ sessionId: 'user_a', kinds: ['file'] })
    expect(out.hits).toHaveLength(1)
    expect(out.hits[0]).toMatchObject({ kind: 'file', fileName: '预算.xlsx', sizeBytes: 40960, sender: '我', isSelf: true })
    expect(out.hits[0].anchor).toEqual({ sessionId: 'user_a', messageId: 'm5', seq: 5, createdAt: T0 + 5 * 60_000 })
    expect(JSON.stringify(out)).not.toContain('path')
    expect(out.coverage.scope).toBe('sessions')
    expect(res.meta?.anchors).toHaveLength(1)
  })
  it('scans recent dm/group sessions (not official) when no sessionId is given, newest first', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(searchMedia, { kind: 'image' }, sub))
    const scanned = sub.calls.filter((c) => c.method === 'listMessages').map((c) => (c.args[0] as { sessionId: string }).sessionId)
    expect(scanned.sort()).toEqual(['grp_1@chatroom', 'user_a'])
    expect(out.hits.map((h: { fileName: string }) => h.fileName)).toEqual(['menu.jpg', 'chart.png'])
    expect(out.coverage).toMatchObject({ scope: 'recent_sessions', sessionCount: 2, bounded: true })
  })
  it('filters by query against file names', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(searchMedia, { kind: 'image', query: 'chart' }, sub))
    expect(out.hits.map((h: { fileName: string }) => h.fileName)).toEqual(['chart.png'])
    expect(body(await runTool(searchMedia, { kind: 'video' }, sub)).note).toContain('视频')
  })
  it('requires kind and caps limit at 30', () => {
    const s = searchMedia.inputSchema
    expect(s.safeParse({}).success).toBe(false)
    expect(s.safeParse({ kind: 'audio' }).success).toBe(false)
    expect(s.safeParse({ kind: 'image', limit: 31 }).success).toBe(false)
    expect(s.safeParse({ kind: 'sticker', limit: 30 }).success).toBe(true)
  })
})
