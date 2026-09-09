import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { truncateToTokens } from '@aiwc/protocol'
import { compactInput, toJsonValue, truncateText, TRUNCATION_MARKER, zodToJsonSchema } from './schema'

describe('truncateText / TRUNCATION_MARKER', () => {
  it('returns the input untouched when within the cap (or cap <= 0)', () => {
    expect(truncateText('abc', 3)).toEqual({ text: 'abc', truncated: false })
    expect(truncateText('abc', 0)).toEqual({ text: 'abc', truncated: false })
  })

  it('cuts at maxChars and appends the marker with the removed count', () => {
    const cut = truncateText('abcdefghij'.repeat(3), 10)
    expect(cut.truncated).toBe(true)
    expect(cut.text).toBe('abcdefghij' + TRUNCATION_MARKER(30, 10))
    expect(cut.text).toContain('[…已截断 20 字]')
  })

  it('marker has the same shape as the one @aiwc/protocol truncateToTokens appends', () => {
    const tokenCut = truncateToTokens('中文内容'.repeat(500), 40)
    const protocolMarker = tokenCut.slice(tokenCut.lastIndexOf('\n'))
    const ours = TRUNCATION_MARKER(30, 10)
    const shape = (m: string): string => m.replace(/\d+/g, 'N')
    expect(shape(ours)).toBe(shape(protocolMarker))
  })
})

describe('zodToJsonSchema', () => {
  it('emits an object schema without $schema', () => {
    const json = zodToJsonSchema(z.object({ text: z.string(), n: z.number().int().optional() }))
    expect(json.$schema).toBeUndefined()
    expect(json.type).toBe('object')
    expect((json.properties as Record<string, unknown>).text).toMatchObject({ type: 'string' })
    expect(json.required).toEqual(['text'])
  })
})

describe('compactInput / toJsonValue', () => {
  it('collapses whitespace and bounds length', () => {
    expect(compactInput({ a: 'x  y   z' })).toBe('{"a":"x y z"}')
    expect(compactInput('a'.repeat(200), 20)).toHaveLength(20)
    expect(compactInput(undefined)).toBe('')
  })

  it('coerces non-JSON values to null / string', () => {
    expect(toJsonValue(undefined)).toBeNull()
    expect(toJsonValue({ a: 1, f: () => 1 })).toEqual({ a: 1 })
    expect(toJsonValue(1n)).toBe('1')
  })
})
