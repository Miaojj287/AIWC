import { describe, expect, it } from 'vitest'
import { SETTINGS_PAGES } from './model'
import { SETTINGS_ROWS, locationOf, scoreRow, searchSettings, tokenize } from './searchIndex'

describe('settings search index', () => {
  it('has unique row ids that all point at a known page', () => {
    const ids = SETTINGS_ROWS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of SETTINGS_ROWS) expect(SETTINGS_PAGES).toContain(r.page)
  })

  it('tokenizes on whitespace and lower-cases', () => {
    expect(tokenize('  模型  ID ')).toEqual(['模型', 'id'])
    expect(tokenize('')).toEqual([])
  })

  it('ranks title matches above keyword and description matches', () => {
    const [first, ...rest] = searchSettings('模型')
    expect(first?.row.title).toMatch(/模型/)
    expect(rest.length).toBeGreaterThan(0)
    // every hit mentions the token somewhere
    for (const h of [first!, ...rest]) expect(scoreRow(h.row, '模型')).toBeGreaterThan(0)
  })

  it('finds rows through synonyms / english keywords', () => {
    const hits = searchSettings('whisper')
    expect(hits.map((h) => h.row.id)).toContain('ai.sttMode')
    const byEnglish = searchSettings('api key')
    expect(byEnglish[0]?.row.id).toBe('ai.apiKey')
  })

  it('requires every token to match (AND) and returns the page · group location', () => {
    const hits = searchSettings('记忆 上限')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.row.id).toBe('memory.maxEntries')
    expect(hits[0]?.location).toBe('记忆 · 记忆策略')
    expect(locationOf(hits[0]!.row)).toBe(hits[0]!.location)
  })

  it('returns nothing for an empty or unmatched query and respects the limit', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('不存在的设置项xyz')).toEqual([])
    expect(searchSettings('密钥', SETTINGS_ROWS, 2)).toHaveLength(2)
  })
})
