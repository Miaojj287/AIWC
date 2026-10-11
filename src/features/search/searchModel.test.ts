import { afterEach, describe, expect, it } from 'vitest'
import type { SearchHit, WxMessage } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import {
  applyOpenRequest,
  DEFAULT_SEARCH_STATE,
  groupHits,
  hasFilters,
  hasMoreResults,
  liveCommit,
  MAX_RESULTS,
  nextLimit,
  PAGE_SIZE,
  parseOpenRequest,
  parseRecent,
  parseSearchState,
  pushRecent,
  RECENT_MAX,
  rangeBounds,
  rangeLabel,
  resultRows,
  searchGate,
  senderLabel,
  toSearchQuery,
} from './searchModel'

const NOW = new Date('2026-10-10T15:30:00').getTime()
const DAY = 86_400_000
const midnight = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function hit(sessionId: string, id: string, createdAt: number, over: Partial<WxMessage> = {}): SearchHit {
  const message: WxMessage = {
    id,
    sessionId,
    seq: createdAt,
    createdAt,
    senderId: 'wxid_sender',
    senderName: 'Sender',
    isSelf: false,
    kind: 'text',
    text: `text ${id}`,
    anchor: { sessionId, messageId: id, seq: createdAt, createdAt },
    ...over,
  }
  return { message, score: 1, snippet: `snippet ${id}`, source: 'fts' }
}

afterEach(() => __resetLanguageForTests())

describe('groupHits / resultRows', () => {
  it('groups by chat in rank order, newest first inside a chat, each message once', () => {
    const hits = [
      hit('b', '1', 100),
      hit('a', '2', 300),
      hit('b', '3', 500),
      hit('a', '2', 300), // listed twice
      hit('c', '4', 50),
    ]
    const groups = groupHits(hits)
    expect(groups.map((g) => g.sessionId)).toEqual(['b', 'a', 'c'])
    expect(groups[0]!.hits.map((h) => h.message.id)).toEqual(['3', '1'])
    expect(groups[1]!.hits).toHaveLength(1)

    const rows = resultRows(groups, true)
    expect(rows.map((r) => r.kind)).toEqual(['group', 'hit', 'hit', 'group', 'hit', 'group', 'hit', 'end'])
    expect(rows[0]).toMatchObject({ kind: 'group', sessionId: 'b', count: 2, first: true })
    expect(rows[3]).toMatchObject({ kind: 'group', sessionId: 'a', first: false })
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    expect(resultRows(groups, false).at(-1)?.kind).toBe('hit')
  })
})

describe('time range', () => {
  it('counts calendar days including today from an injected clock', () => {
    expect(rangeBounds({ preset: 'all' }, NOW)).toEqual({})
    expect(rangeBounds({ preset: '7d' }, NOW)).toEqual({ from: midnight(NOW) - 6 * DAY })
    expect(rangeBounds({ preset: '30d' }, NOW)).toEqual({ from: midnight(NOW) - 29 * DAY })
    expect(rangeBounds({ preset: '1y' }, NOW)).toEqual({ from: midnight(NOW) - 364 * DAY })
  })

  it('passes custom bounds through and orders them', () => {
    expect(rangeBounds({ preset: 'custom', from: 10, to: 20 }, NOW)).toEqual({ from: 10, to: 20 })
    expect(rangeBounds({ preset: 'custom', from: 20, to: 10 }, NOW)).toEqual({ from: 10, to: 20 })
    expect(rangeBounds({ preset: 'custom', from: 10 }, NOW)).toEqual({ from: 10, to: undefined })
  })

  it('labels presets and custom spans in both languages', () => {
    expect(rangeLabel({ preset: '7d' }, NOW)).toBe('最近 7 天')
    expect(rangeLabel({ preset: 'custom', from: midnight(NOW) - DAY, to: NOW }, NOW)).toBe('昨天 – 今天')
    setLanguage('en-US')
    expect(rangeLabel({ preset: '1y' }, NOW)).toBe('Past year')
    expect(rangeLabel({ preset: 'custom', to: NOW }, NOW)).toBe('Until Today')
  })
})

describe('toSearchQuery', () => {
  it('asks for keyword matches in the local index only, with the scope and bounds', () => {
    expect(toSearchQuery({ query: ' 聚餐 ', sessionIds: [], range: { preset: 'all' } }, PAGE_SIZE, NOW)).toEqual({
      query: '聚餐',
      limit: PAGE_SIZE,
      mode: 'keyword',
      match: 'exact',
    })
    expect(toSearchQuery({ query: 'x', sessionIds: ['g@chatroom'], range: { preset: '7d' } }, 200, NOW)).toEqual({
      query: 'x',
      sessionIds: ['g@chatroom'],
      from: midnight(NOW) - 6 * DAY,
      limit: 200,
      mode: 'keyword',
      match: 'exact',
    })
  })
})

describe('paging', () => {
  it('grows the page and stops at the cap', () => {
    expect(nextLimit(PAGE_SIZE)).toBe(PAGE_SIZE * 2)
    expect(nextLimit(MAX_RESULTS - 10)).toBe(MAX_RESULTS)
    expect(hasMoreResults(PAGE_SIZE, PAGE_SIZE)).toBe(true)
    expect(hasMoreResults(PAGE_SIZE - 1, PAGE_SIZE)).toBe(false)
    expect(hasMoreResults(MAX_RESULTS, MAX_RESULTS)).toBe(false)
  })
})

describe('tab state and tab.openSearch', () => {
  it('validates stored state', () => {
    expect(parseSearchState(undefined)).toEqual(DEFAULT_SEARCH_STATE)
    expect(
      parseSearchState({ query: ' 周会 ', sessionIds: ['a', '', 3, 'a'], range: { preset: 'bogus' }, request: 'x' }),
    ).toEqual({ query: '周会', sessionIds: ['a'], range: { preset: 'all' }, request: 0 })
    expect(parseSearchState({ range: { preset: 'custom', from: 'x' } }).range).toEqual({ preset: 'all' })
    expect(parseSearchState({ range: { preset: '30d' } }).range).toEqual({ preset: '30d' })
  })

  it('keeps only well-formed request fields', () => {
    expect(parseOpenRequest(null)).toEqual({})
    expect(parseOpenRequest({ query: ' 合同 ', sessionIds: ['a', 1], from: Number.NaN, to: 5 })).toEqual({
      query: '合同',
      sessionIds: ['a'],
      to: 5,
    })
  })

  it('a bare request keeps the search and only asks for focus', () => {
    const prev = { query: '周会', sessionIds: ['a'], range: { preset: '7d' as const }, request: 3 }
    expect(applyOpenRequest(prev, {})).toEqual({ ...prev, request: 4 })
  })

  it('a request with a query searches every chat at any time unless it says otherwise', () => {
    const prev = { query: '周会', sessionIds: ['a'], range: { preset: '7d' as const }, request: 3 }
    expect(applyOpenRequest(prev, { query: '合同' })).toEqual({
      query: '合同',
      sessionIds: [],
      range: { preset: 'all' },
      request: 4,
    })
    expect(applyOpenRequest(prev, { sessionIds: ['b'], from: 1, to: 2 })).toEqual({
      query: '周会',
      sessionIds: ['b'],
      range: { preset: 'custom', from: 1, to: 2 },
      request: 4,
    })
  })

  it('knows when filters narrow the search', () => {
    expect(hasFilters(DEFAULT_SEARCH_STATE)).toBe(false)
    expect(hasFilters({ sessionIds: ['a'], range: { preset: 'all' } })).toBe(true)
    expect(hasFilters({ sessionIds: [], range: { preset: '30d' } })).toBe(true)
  })
})

describe('liveCommit', () => {
  it('commits two or more characters, clears when cut short, and ignores the committed query', () => {
    expect(liveCommit('聚', '')).toBeUndefined()
    expect(liveCommit('聚餐', '')).toBe('聚餐')
    expect(liveCommit(' 聚餐 ', '聚餐')).toBeUndefined()
    expect(liveCommit('聚', '聚餐')).toBe('')
    expect(liveCommit('', '聚餐')).toBe('')
    expect(liveCommit('', '')).toBeUndefined()
    // Enter may commit a single character; the box then holds exactly that.
    expect(liveCommit('饭', '饭')).toBeUndefined()
  })
})

describe('searchGate', () => {
  it('reads the connection state, never an error text', () => {
    expect(searchGate('ready', false)).toBe('ready')
    expect(searchGate('connecting', false)).toBe('waiting')
    expect(searchGate(undefined, true)).toBe('waiting')
    expect(searchGate(undefined, false)).toBe('ready')
    for (const state of ['no_config', 'locked', 'error'] as const)
      expect(searchGate(state, false)).toBe('not_connected')
  })
})

describe('hit text', () => {
  it('names the sender: me, the stored name, else the direct chat', () => {
    const base = { senderId: 'wxid_x', senderName: undefined }
    expect(senderLabel({ ...base, isSelf: true }, { me: '我', direct: true, chatTitle: '小王' })).toBe('我')
    expect(senderLabel({ ...base, isSelf: false, senderName: ' 李明 ' }, { me: '我', direct: false })).toBe('李明')
    expect(senderLabel({ ...base, isSelf: false }, { me: '我', direct: true, chatTitle: '小王' })).toBe('小王')
    expect(senderLabel({ ...base, isSelf: false }, { me: '我', direct: false })).toBe('wxid_x')
  })
})

describe('recent searches', () => {
  it('puts the newest first without repeats, capped', () => {
    expect(pushRecent(['a', 'b'], ' b ')).toEqual(['b', 'a'])
    expect(pushRecent(['a'], '  ')).toEqual(['a'])
    const many = Array.from({ length: RECENT_MAX }, (_, i) => `q${i}`)
    expect(pushRecent(many, 'new')).toHaveLength(RECENT_MAX)
    expect(pushRecent(many, 'new')[0]).toBe('new')
  })

  it('reads back only a list of strings', () => {
    expect(parseRecent('nope')).toEqual([])
    expect(parseRecent([' a ', 1, 'a', '', 'b'])).toEqual(['a', 'b'])
  })
})
