/**
 * The two catalogs must be the same shape (tsc already enforces this) AND use the same placeholders
 * in every message — a `{name}` present in zh but missing in en renders as a hole at runtime.
 */
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from '@aiwc/protocol'
import { catalogs, leafKeys, placeholdersOf, translate } from './index'
import { zhCN } from './locales/zh-CN'
import { lookup } from './core'

describe('catalog parity', () => {
  const reference = leafKeys(zhCN)

  it('has at least one language besides the reference', () => {
    expect(LANGUAGES.length).toBeGreaterThan(1)
    for (const language of LANGUAGES) expect(catalogs[language]).toBeDefined()
  })

  it.each(LANGUAGES)('%s has exactly the reference keys', (language) => {
    const keys = leafKeys(catalogs[language])
    const missing = reference.filter((k) => !keys.includes(k))
    const extra = keys.filter((k) => !reference.includes(k))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(LANGUAGES)('%s has no empty messages', (language) => {
    const empty = leafKeys(catalogs[language]).filter((k) => (lookup(catalogs[language], k) ?? '').trim() === '')
    expect(empty).toEqual([])
  })

  it.each(LANGUAGES)('%s uses the same placeholders as the reference', (language) => {
    const mismatched: string[] = []
    for (const key of reference) {
      const a = placeholdersOf(lookup(zhCN, key) ?? '')
      const b = placeholdersOf(lookup(catalogs[language], key) ?? '')
      if (a.join(',') !== b.join(',')) mismatched.push(`${key}: zh-CN {${a}} vs ${language} {${b}}`)
    }
    expect(mismatched).toEqual([])
  })

  it('falls back to the key itself when a key is missing', () => {
    const missing = 'common.__missing__' as never
    expect(translate('en-US', missing)).toBe('common.__missing__')
    expect(translate('zh-CN', 'common.cancel')).toBe('取消')
    expect(translate('en-US', 'common.cancel')).toBe('Cancel')
  })
})
