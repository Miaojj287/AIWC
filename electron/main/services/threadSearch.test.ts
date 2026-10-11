import { describe, expect, it } from 'vitest'
import { THREAD_SEARCH_MARKS, type ThreadId } from '@aiwc/protocol'
import type { RolloutSearchHit } from '@aiwc/kernel'
import { cleanSnippet, groupThreadHits, searchLimit, searchQuery, THREAD_SEARCH_MAX_LIMIT } from './threadSearch'

const [o, c] = THREAD_SEARCH_MARKS
const hit = (threadId: string, itemId: string, snippet: string, ts: number): RolloutSearchHit => ({
  threadId: threadId as ThreadId,
  itemId: itemId as never,
  snippet,
  ts,
  title: `标题${threadId}`,
})

describe('cleanSnippet', () => {
  it('reduces citation links to their labels and drops a link cut off at either end', () => {
    expect(cleanSnippet(`张三说 [02-14 19:28](wx://g1/m1) ${o}报价${c}要降`)).toBe(
      `张三说 02-14 19:28 ${o}报价${c}要降`,
    )
    expect(cleanSnippet(`…](wx://g1/m1) 之后的${o}报价${c}`)).toBe(`… 之后的${o}报价${c}`)
    expect(cleanSnippet(`${o}报价${c}见 [02-14 19:28](wx://g1/m`)).toBe(`${o}报价${c}见 02-14 19:28`)
    expect(cleanSnippet('多行\n  文本\t里')).toBe('多行 文本 里')
  })
})

describe('groupThreadHits', () => {
  it('keeps the newest hit of each thread, in order, up to the limit', () => {
    const grouped = groupThreadHits(
      [hit('a', 'a2', 'x', 30), hit('b', 'b1', 'y', 20), hit('a', 'a1', 'z', 10), hit('c', 'c1', 'w', 5)],
      2,
    )
    expect(grouped.map((g) => [g.threadId, g.itemId])).toEqual([
      ['a', 'a2'],
      ['b', 'b1'],
    ])
    expect(grouped[0]?.title).toBe('标题a')
  })
})

describe('input bounds', () => {
  it('trims and caps the query and clamps the limit', () => {
    expect(searchQuery('  报价 ')).toBe('报价')
    expect(searchQuery(42)).toBe('')
    expect(searchQuery('x'.repeat(500))).toHaveLength(200)
    expect(searchLimit(undefined)).toBe(20)
    expect(searchLimit(0)).toBe(1)
    expect(searchLimit(10_000)).toBe(THREAD_SEARCH_MAX_LIMIT)
  })
})
