import { afterEach, describe, expect, it } from 'vitest'
import type { EmbeddingClient, WxMessage, WxSession } from '@aiwc/protocol'
import { createMirror, type Mirror } from './index'
import { buildFtsQueries } from './search'
import { buildChunks, CHUNK_GAP_MS } from './chunks'
import { alignVectorHits, fuseHits, reciprocalRankFusion } from './rrf'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const T0 = Date.UTC(2026, 0, 5, 1, 0, 0) // 2026-01-05 01:00 UTC

function msg(sessionId: string, seq: number, text: string, opts: Partial<WxMessage> = {}): WxMessage {
  const createdAt = opts.createdAt ?? T0 + seq * 60_000
  const id = opts.id ?? `${sessionId}#${seq}`
  return {
    id,
    sessionId,
    seq,
    createdAt,
    senderId: opts.senderId ?? (opts.isSelf ? 'me' : 'wxid_peer'),
    senderName: opts.senderName ?? (opts.isSelf ? '我' : '张三'),
    isSelf: opts.isSelf ?? false,
    kind: opts.kind ?? 'text',
    text,
    media: opts.media,
    quote: opts.quote,
    anchor: { sessionId, messageId: id, seq, createdAt },
  }
}

const session = (id: string, kind: WxSession['kind'], title: string, extra: Partial<WxSession> = {}): WxSession => ({
  id,
  kind,
  title,
  unread: 0,
  pinned: false,
  muted: false,
  ...extra,
})

const mirrors: Mirror[] = []
const open = (embeddings?: EmbeddingClient) => {
  const m = createMirror({ dbPath: ':memory:', embeddings })
  mirrors.push(m)
  return m
}
afterEach(() => {
  while (mirrors.length) mirrors.pop()?.close()
})

describe('mirror: sessions & messages', () => {
  it('upserts sessions, inserts messages with dedupe and maintains watermark / counters', () => {
    const m = open()
    m.upsertSessions([session('wxid_a', 'dm', '阿甲'), session('g1@chatroom', 'group', '产品群', { pinned: true, memberCount: 12 })])
    const r1 = m.insertMessages([msg('wxid_a', 1, '你好'), msg('wxid_a', 2, '我们的产品市场很大'), msg('wxid_a', 3, 'roadmap 下周发')])
    expect(r1.inserted).toBe(3)
    expect(r1.changedSessions).toEqual(['wxid_a'])
    const r2 = m.insertMessages([msg('wxid_a', 2, 'dup'), msg('wxid_a', 4, '收到')])
    expect(r2.inserted).toBe(1)
    expect(m.watermark('wxid_a')).toBe(4)
    expect(m.countMessages('wxid_a')).toBe(4)
    const s = m.getSession('wxid_a')
    expect(s?.indexedCount).toBe(4)
    expect(s?.lastPreview).toBe('收到')
    expect(s?.lastMessageAt).toBe(T0 + 4 * 60_000)
    // unknown session gets a row automatically
    m.insertMessages([msg('wxid_new', 10, 'hi')])
    expect(m.getSession('wxid_new')?.kind).toBe('dm')
    expect(m.watermark('nope')).toBe(0)
  })

  it('lists sessions: pinned first then recency, filters kind/unread/hidden/query', () => {
    const m = open()
    m.upsertSessions([
      session('wxid_a', 'dm', '阿甲', { lastMessageAt: 300, unread: 2 }),
      session('g1@chatroom', 'group', '产品群', { lastMessageAt: 100, pinned: true }),
      session('gh_news', 'official', '新闻', { lastMessageAt: 500 }),
      session('wxid_b', 'dm', '阿乙', { lastMessageAt: 400 }),
    ])
    const all = m.listSessions({ limit: 10 })
    expect(all.items.map((s) => s.id)).toEqual(['g1@chatroom', 'gh_news', 'wxid_b', 'wxid_a'])
    expect(all.total).toBe(4)
    expect(all.hasMore).toBe(false)
    expect(m.listSessions({ limit: 10, kind: 'dm' }).items.map((s) => s.id)).toEqual(['wxid_b', 'wxid_a'])
    expect(m.listSessions({ limit: 10, unreadOnly: true }).items.map((s) => s.id)).toEqual(['wxid_a'])
    expect(m.listSessions({ limit: 10, query: '产品' }).items.map((s) => s.id)).toEqual(['g1@chatroom'])
    const page = m.listSessions({ limit: 2, offset: 0 })
    expect(page.items).toHaveLength(2)
    expect(page.hasMore).toBe(true)

    m.setSessionFlags('gh_news', { hidden: true })
    expect(m.listSessions({ limit: 10 }).items.map((s) => s.id)).not.toContain('gh_news')
    expect(m.listSessions({ limit: 10, includeHidden: true }).items.map((s) => s.id)).toContain('gh_news')

    // local pin survives a source refresh
    m.setSessionFlags('wxid_a', { pinned: true, read: true })
    m.upsertSessions([session('wxid_a', 'dm', '阿甲', { lastMessageAt: 300, unread: 0 })])
    const a = m.getSession('wxid_a')
    expect(a?.pinned).toBe(true)
    expect(a?.unread).toBe(0)
    // both pinned now → recency decides among pinned
    expect(m.listSessions({ limit: 10 }).items.slice(0, 2).map((s) => s.id)).toEqual(['wxid_a', 'g1@chatroom'])
  })

  it('pages messages before/after with filters and returns context around an anchor', () => {
    const m = open()
    const list: WxMessage[] = []
    for (let i = 1; i <= 30; i++) list.push(msg('wxid_a', i, `消息 ${i}`, { isSelf: i % 2 === 0, kind: i % 10 === 0 ? 'image' : 'text' }))
    m.insertMessages(list)

    const latest = m.listMessages({ sessionId: 'wxid_a', limit: 10 })
    expect(latest.items.map((x) => x.seq)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(latest.hasMore).toBe(true)

    const before = m.listMessages({ sessionId: 'wxid_a', beforeSeq: 21, limit: 10 })
    expect(before.items.map((x) => x.seq)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(before.hasMore).toBe(true)
    const first = m.listMessages({ sessionId: 'wxid_a', beforeSeq: 11, limit: 20 })
    expect(first.items.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(first.hasMore).toBe(false)

    const after = m.listMessages({ sessionId: 'wxid_a', afterSeq: 28, limit: 5 })
    expect(after.items.map((x) => x.seq)).toEqual([29, 30])
    expect(after.hasMore).toBe(false)

    const selfImages = m.listMessages({ sessionId: 'wxid_a', limit: 50, senderIds: ['me'], kinds: ['image'] })
    expect(selfImages.items.map((x) => x.seq)).toEqual([10, 20, 30])

    const ranged = m.listMessages({ sessionId: 'wxid_a', limit: 50, from: T0 + 5 * 60_000, to: T0 + 7 * 60_000 })
    expect(ranged.items.map((x) => x.seq)).toEqual([5, 6, 7])

    const ctx = m.getContext({ sessionId: 'wxid_a', messageId: 'wxid_a#15', seq: 15, createdAt: 0 }, 2)
    expect(ctx.map((x) => x.seq)).toEqual([13, 14, 15, 16, 17])
    const edge = m.getContext({ sessionId: 'wxid_a', messageId: 'wxid_a#1', seq: 1, createdAt: 0 }, 3)
    expect(edge.map((x) => x.seq)).toEqual([1, 2, 3, 4])

    expect(m.getMessage('wxid_a', 'wxid_a#7')?.text).toBe('消息 7')
    expect(m.getMessageBySeq('wxid_a', 8)?.id).toBe('wxid_a#8')
    expect(m.oldestSeq('wxid_a')).toBe(1)
    expect(m.newestSeq('wxid_a')).toBe(30)
    expect(m.oldestSeq('none')).toBeUndefined()
  })

  it('removeSession drops messages and resets the watermark but keeps the session row', () => {
    const m = open()
    m.upsertSessions([session('wxid_a', 'dm', '阿甲')])
    m.insertMessages([msg('wxid_a', 1, 'a'), msg('wxid_a', 2, 'b')])
    m.transcripts.set('wxid_a', 'wxid_a#1', 'hello')
    m.removeSession('wxid_a')
    expect(m.countMessages('wxid_a')).toBe(0)
    expect(m.watermark('wxid_a')).toBe(0)
    expect(m.getSession('wxid_a')?.title).toBe('阿甲')
    expect(m.transcripts.get('wxid_a', 'wxid_a#1')).toBeUndefined()
  })

  it('stores contacts and group members', () => {
    const m = open()
    m.upsertContacts([
      { username: 'wxid_a', nickname: 'Alice', remark: '阿甲', kind: 'friend' },
      { username: 'wxid_b', nickname: 'Bob', kind: 'friend' },
      { username: 'gh_x', nickname: '公众号', kind: 'official' },
    ])
    expect(m.listContacts({ limit: 10 }).total).toBe(3)
    expect(m.listContacts({ limit: 10, kind: 'friend' }).items.map((c) => c.username).sort()).toEqual(['wxid_a', 'wxid_b'])
    expect(m.listContacts({ limit: 10, query: 'ali' }).items.map((c) => c.username)).toEqual(['wxid_a'])
    expect(m.getContact('wxid_a')?.remark).toBe('阿甲')

    m.upsertSessions([session('g1@chatroom', 'group', '产品群')])
    m.upsertGroupMembers('g1@chatroom', [{ username: 'wxid_a', displayName: '甲总' }, { username: 'wxid_z', displayName: '路人' }])
    const members = m.listGroupMembers('g1@chatroom')
    expect(members.total).toBe(2)
    const a = members.items.find((c) => c.username === 'wxid_a')
    expect(a?.nickname).toBe('Alice')
    const z = members.items.find((c) => c.username === 'wxid_z')
    expect(z?.nickname).toBe('路人')
    expect(z?.kind).toBe('stranger')
    expect(m.getSession('g1@chatroom')?.memberCount).toBe(2)
    expect(m.hasGroupMembers('g1@chatroom')).toBe(true)
    expect(m.hasGroupMembers('g2@chatroom')).toBe(false)
  })
})

describe('mirror: keyword search', () => {
  it('builds per-index queries', () => {
    expect(buildFtsQueries('产品市场')).toEqual({ trigram: '"产品市场"', like: [] })
    expect(buildFtsQueries('产品')).toEqual({ like: ['产品'] })
    const mixed = buildFtsQueries('产品市场 roadmap')
    expect(mixed.trigram).toBe('"产品市场" "roadmap"')
    expect(mixed.unicode).toBe('"roadmap"*')
    expect(buildFtsQueries('  ')).toEqual({ like: [] })
    expect(buildFtsQueries('say "hi"')).toEqual({ unicode: '"say"* "hi"*', trigram: '"say"', like: [] })
  })

  it('finds CJK via trigram and latin via unicode61, with snippets and filters', () => {
    const m = open()
    m.insertMessages([
      msg('wxid_a', 1, '我们的产品市场很大，先做华东'),
      msg('wxid_a', 2, 'The roadmap for Q3 is ready'),
      msg('wxid_a', 3, '今天天气不错'),
      msg('g1@chatroom', 4, '产品市场部下周开会讨论 roadmap'),
      msg('g1@chatroom', 5, '午饭吃什么'),
    ])
    const cjk = m.searchFts('产品市场', { limit: 10 })
    expect(cjk.map((h) => h.message.seq).sort()).toEqual([1, 4])
    expect(cjk[0]?.snippet).toContain('[产品市场]')
    expect(cjk[0]?.source).toBe('fts')

    const latin = m.searchFts('roadmap', { limit: 10 })
    expect(latin.map((h) => h.message.seq).sort()).toEqual([2, 4])
    expect(latin.some((h) => h.snippet.includes('[roadmap]'))).toBe(true)

    const both = m.searchFts('产品市场 roadmap', { limit: 10 })
    expect(both[0]?.message.seq).toBe(4) // matches both terms → ranked first

    const scoped = m.searchFts('产品市场', { limit: 10, sessionIds: ['wxid_a'] })
    expect(scoped.map((h) => h.message.seq)).toEqual([1])
    const ranged = m.searchFts('产品市场', { limit: 10, from: T0 + 3 * 60_000 })
    expect(ranged.map((h) => h.message.seq)).toEqual([4])

    // 2-char CJK falls back to LIKE
    const short = m.searchFts('午饭', { limit: 10 })
    expect(short.map((h) => h.message.seq)).toEqual([5])
    expect(short[0]?.snippet).toContain('[午饭]')

    expect(m.searchFts('不存在的词汇', { limit: 10 })).toEqual([])
    expect(m.searchFts('', { limit: 10 })).toEqual([])
  })
})

describe('mirror: chunks & vectors', () => {
  it('chunks by chars / count / gap', () => {
    const inputs = []
    for (let i = 1; i <= 20; i++) inputs.push({ seq: i, createdAt: T0 + i * 1000, text: `m${i}` })
    const byCount = buildChunks(inputs)
    expect(byCount.map((c) => c.msgCount)).toEqual([15, 5])
    expect(byCount[0]?.anchorSeq).toBe(8)
    const gap = buildChunks([
      { seq: 1, createdAt: T0, text: 'a' },
      { seq: 2, createdAt: T0 + CHUNK_GAP_MS + 1, text: 'b' },
    ])
    expect(gap).toHaveLength(2)
    const big = buildChunks([
      { seq: 1, createdAt: T0, text: 'x'.repeat(500) },
      { seq: 2, createdAt: T0 + 1, text: 'y'.repeat(200) },
    ])
    expect(big).toHaveLength(2)
    expect(buildChunks([{ seq: 1, createdAt: T0, text: '   ' }])).toEqual([])
  })

  it('ensureChunks embeds lazily and searchVector ranks by cosine', async () => {
    // toy embedding: bag of two topics
    const embed = (t: string) => [t.includes('发票') ? 1 : 0, t.includes('周末') ? 1 : 0, 0.01]
    const calls: string[][] = []
    const embeddings: EmbeddingClient = {
      modelId: 'toy',
      dimensions: 3,
      async embed(values) {
        calls.push(values)
        return values.map(embed)
      },
    }
    const m = open(embeddings)
    expect(m.hasEmbeddings).toBe(true)
    m.insertMessages([
      msg('wxid_a', 1, '发票开好了吗', { createdAt: T0 }),
      msg('wxid_a', 2, '发票明天寄给你', { createdAt: T0 + 1000 }),
      msg('wxid_a', 3, '周末去爬山吧', { createdAt: T0 + CHUNK_GAP_MS * 2 }),
      msg('wxid_a', 4, '周末天气不错', { createdAt: T0 + CHUNK_GAP_MS * 2 + 1000 }),
      msg('wxid_a', 5, '', { kind: 'image', createdAt: T0 + CHUNK_GAP_MS * 2 + 2000 }),
    ])
    const r = await m.ensureChunks('wxid_a')
    expect(r.chunks).toBe(2)
    expect(r.embedded).toBe(2)
    expect(r.pending).toBe(0)
    expect(calls).toHaveLength(1)

    const hits = m.searchVector([0, 1, 0], { limit: 5 })
    expect(hits[0]?.message.seq).toBeGreaterThanOrEqual(3)
    expect(hits[0]?.source).toBe('vector')
    expect(hits[0]?.snippet).toContain('周末')
    const sem = await m.searchSemantic('发票', { limit: 1 })
    expect(sem[0]?.message.seq).toBeLessThanOrEqual(2)

    // incremental: only new messages get chunked
    m.insertMessages([msg('wxid_a', 6, '发票收到了', { createdAt: T0 + CHUNK_GAP_MS * 5 })])
    const r2 = await m.ensureChunks('wxid_a')
    expect(r2.chunks).toBe(1)
    const again = await m.ensureChunks('wxid_a')
    expect(again.chunks).toBe(0)
    expect(again.embedded).toBe(0)
  })

  it('reports pending chunks without embeddings and semantic search is unsupported', async () => {
    const m = open()
    m.insertMessages([msg('wxid_a', 1, 'hello')])
    const r = await m.ensureChunks('wxid_a')
    expect(r).toEqual({ chunks: 1, embedded: 0, pending: 1 })
    await expect(m.searchSemantic('x', { limit: 1 })).rejects.toThrow()
    expect(m.searchVector([1, 0], { limit: 1 })).toEqual([])
  })
})

describe('mirror: stats', () => {
  it('computes overview, ranking and time distribution', () => {
    const m = open()
    m.upsertSessions([session('wxid_a', 'dm', '阿甲'), session('g1@chatroom', 'group', '产品群')])
    const list: WxMessage[] = []
    for (let i = 1; i <= 6; i++) list.push(msg('wxid_a', i, `a${i}`, { isSelf: i % 2 === 0, createdAt: T0 + i * 3_600_000 }))
    for (let i = 1; i <= 4; i++) list.push(msg('g1@chatroom', i, `g${i}`, { senderId: `u${i % 2}`, senderName: `成员${i % 2}`, kind: i === 4 ? 'image' : 'text', createdAt: T0 + 86_400_000 * 3 + i * 1000 }))
    m.insertMessages(list)

    const ov = m.stats({ metric: 'overview' })
    expect(ov.total).toBe(10)
    const val = (k: string) => ov.rows.find((r) => r.key === k)?.value
    expect(val('self')).toBe(3)
    expect(val('sessions')).toBe(2)
    expect(val('kind:text')).toBe(9)
    expect(val('kind:image')).toBe(1)
    expect(val('active_days')).toBeGreaterThanOrEqual(2)

    const bySession = m.stats({ metric: 'ranking', limit: 5 })
    expect(bySession.rows[0]).toMatchObject({ id: 'wxid_a', name: '阿甲', count: 6 })
    const bySender = m.stats({ metric: 'ranking', sessionId: 'g1@chatroom' })
    expect(bySender.rows).toHaveLength(2)
    expect(bySender.rows[0]?.count).toBe(2)
    expect(bySender.total).toBe(4)

    const hours = m.stats({ metric: 'time_distribution', groupBy: 'hour', sessionId: 'wxid_a' })
    expect(hours.rows).toHaveLength(24)
    expect(hours.total).toBe(6)
    const days = m.stats({ metric: 'time_distribution', groupBy: 'day' })
    expect(days.rows.length).toBeGreaterThanOrEqual(2)
    const wk = m.stats({ metric: 'time_distribution', groupBy: 'weekday' })
    expect(wk.rows).toHaveLength(7)
  })
})

describe('rrf', () => {
  it('fuses ranked lists and prefers items present in several lists', () => {
    const a = [{ item: 'x', rank: 1 }, { item: 'y', rank: 2 }, { item: 'z', rank: 3 }]
    const b = [{ item: 'z', rank: 1 }, { item: 'y', rank: 2 }]
    const merged = reciprocalRankFusion([a, b], (s) => s)
    expect(merged.map((m) => m.key)).toEqual(['z', 'y', 'x'])
    expect(merged[0]?.ranks).toEqual([3, 1])
  })
  it('fuseHits marks overlaps as fused and keeps the keyword snippet', () => {
    const mk = (seq: number, source: 'fts' | 'vector', snippet: string) => ({ message: msg('s', seq, `t${seq}`), score: 1, snippet, source })
    const fts = [mk(1, 'fts', '[k]1'), mk(2, 'fts', '[k]2')]
    const vec = [mk(2, 'vector', 'v2'), mk(3, 'vector', 'v3')]
    const out = fuseHits([fts, vec], 10)
    expect(out[0]?.message.seq).toBe(2)
    expect(out[0]?.source).toBe('fused')
    expect(out[0]?.snippet).toBe('[k]2')
    expect(out.map((h) => h.source).filter((s) => s === 'fused')).toHaveLength(1)
    expect(fuseHits([fts, vec], 1)).toHaveLength(1)
  })
  it('alignVectorHits re-anchors chunk hits on keyword hits inside the chunk range', () => {
    const kw = [
      { message: msg('s', 7, 'k7'), score: 1, snippet: '[k]7', source: 'fts' as const },
      { message: msg('s', 40, 'k40'), score: 1, snippet: '[k]40', source: 'fts' as const },
    ]
    const vec = [
      { message: msg('s', 8, 'anchor'), score: 0.9, snippet: 'chunk 1-15', source: 'vector' as const, range: { startSeq: 1, endSeq: 15 } },
      { message: msg('s', 23, 'anchor'), score: 0.8, snippet: 'chunk 16-30', source: 'vector' as const, range: { startSeq: 16, endSeq: 30 } },
    ]
    const aligned = alignVectorHits(vec, kw)
    expect(aligned[0]?.message.seq).toBe(7)
    expect(aligned[0]?.snippet).toBe('chunk 1-15')
    expect(aligned[1]?.message.seq).toBe(23)
    const fused = fuseHits([kw, aligned], 10)
    expect(fused[0]?.message.seq).toBe(7)
    expect(fused[0]?.source).toBe('fused')
  })
})

describe('mirror: on-disk persistence', () => {
  it('creates the db (with parent dirs, WAL) and reopens with data intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwc-mirror-'))
    const dbPath = join(dir, 'nested', 'index.db')
    try {
      const a = createMirror({ dbPath })
      a.upsertSessions([session('wxid_a', 'dm', '阿甲')])
      a.insertMessages([msg('wxid_a', 1, '持久化测试 产品市场')])
      a.meta.set('hello', 'world')
      a.close()
      expect(existsSync(dbPath)).toBe(true)
      const b = createMirror({ dbPath })
      expect(b.countMessages()).toBe(1)
      expect(b.meta.get('hello')).toBe('world')
      expect(b.meta.get('schema_version')).toBe('3')
      expect(b.searchFts('产品市场', { limit: 5 })).toHaveLength(1)
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})


describe('mirror: source provenance', () => {
  it('clears legacy and cross-account data, including search and contacts, but retains the same source', async () => {
    const m = open()
    m.upsertSessions([session('old', 'dm', 'Old')])
    m.upsertContacts([{ username: 'old', nickname: 'Old', kind: 'friend' }])
    m.insertMessages([msg('old', 1, 'legacy searchable message')])
    m.bindSource('wcdb:account-a')
    expect(m.countMessages()).toBe(0)
    expect(m.listSessions({ includeHidden: true }).total).toBe(0)
    expect(m.getContact('old')).toBeUndefined()
    expect(m.searchFts('legacy', { limit: 10 })).toEqual([])
    m.upsertSessions([session('new', 'group', 'New', { collapsed: true })])
    m.insertMessages([msg('new', 1, 'verified message')])
    m.bindSource('wcdb:account-a')
    expect(m.countMessages()).toBe(1)
    expect(m.getSession('new')?.collapsed).toBe(true)
    m.bindSource('wcdb:account-b')
    expect(m.countMessages()).toBe(0)
  })
})

it('upgrades legacy presentation on reread without duplicating messages or losing cached media', () => {
  const mirror = createMirror({ dbPath: ':memory:' })
  try {
    const old = msg('s', 1, '我拍了拍好友', { kind: 'link', media: { kind: 'image', path: '/cached.jpg' } })
    mirror.insertMessages([old])
    const fresh: WxMessage = { ...old, kind: 'system', media: undefined, presentationVersion: 1 }
    expect(mirror.insertMessages([fresh]).inserted).toBe(0)
    expect(mirror.getMessage('s', old.id)).toMatchObject({ kind: 'system', presentationVersion: 1, media: { path: '/cached.jpg' } })
    expect(mirror.countMessages('s')).toBe(1)
    expect(mirror.watermark('s')).toBe(1)
    const article: WxMessage = { ...fresh, kind: 'link', rich: { type: 'article', title: '文章', url: 'https://example.com/' } }
    mirror.insertMessages([article])
    expect(mirror.getMessage('s', old.id)?.rich).toEqual(article.rich)
  } finally { mirror.close() }
})

it('keeps old and new messages whose shards share local ids and upgrades legacy rows in place', () => {
  const m = createMirror({ dbPath: ':memory:' })
  try {
    const old = msg('Tencent-Games', 1747309846000, '旧文章', { id: '125', createdAt: 1747309846000, media: { kind: 'image', path: '/cache/old.png' } })
    m.insertMessages([old])
    const upgraded = { ...old, id: `wx:125:${old.seq}`, media: undefined }
    m.insertMessages([upgraded])
    const latest = msg('Tencent-Games', 1788775756000, '最新文章', { id: 'wx:125:1788775756000', createdAt: 1788775756000 })
    m.insertMessages([latest], { advanceWatermark: false })
    expect(m.countMessages('Tencent-Games')).toBe(2)
    expect(m.getMessage('Tencent-Games', upgraded.id)?.media?.path).toBe('/cache/old.png')
    expect(m.listMessages({ sessionId: 'Tencent-Games', limit: 1 }).items[0]?.text).toBe('最新文章')
    expect(m.watermark('Tencent-Games')).toBe(old.seq)
  } finally { m.close() }
})

it('repairs an inflated legacy sync watermark once without deleting indexed history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-identity-upgrade-'))
  const dbPath = join(dir, 'mirror.db')
  try {
    const old = createMirror({ dbPath })
    old.bindSource(JSON.stringify(['wcdb', '/source', 'wxid_self']))
    old.insertMessages([msg('s', 10, '保留的历史', { id: '125' })])
    old.setWatermark('s', 1000)
    old.close()
    const repaired = createMirror({ dbPath })
    expect(repaired.watermark('s')).toBe(0)
    expect(repaired.countMessages('s')).toBe(1)
    repaired.setWatermark('s', 20)
    repaired.close()
    const reopened = createMirror({ dbPath })
    expect(reopened.watermark('s')).toBe(20)
    reopened.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
