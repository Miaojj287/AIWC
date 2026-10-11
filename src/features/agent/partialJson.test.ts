import { describe, expect, it } from 'vitest'
import { parsePartialJson } from './partialJson'

describe('parsePartialJson', () => {
  it('reads what the model has written so far', () => {
    expect(parsePartialJson('{"query": "周')).toEqual({ query: '周' })
    expect(parsePartialJson('{"query": "周报", "sessionIds": ["a", "b')).toEqual({
      query: '周报',
      sessionIds: ['a', 'b'],
    })
    expect(parsePartialJson('{"steps":[{"title":"读取","status":"done"},{"ti')).toEqual({
      steps: [{ title: '读取', status: 'done' }, {}],
    })
  })

  it('drops a key without its value, a dangling comma and half-written literals', () => {
    expect(parsePartialJson('{"a": 1, "b')).toEqual({ a: 1 })
    expect(parsePartialJson('{"a": 1, "b":')).toEqual({ a: 1 })
    expect(parsePartialJson('{"a": 1,')).toEqual({ a: 1 })
    expect(parsePartialJson('{"a": tr')).toEqual({})
    expect(parsePartialJson('{"a": 1.')).toEqual({})
    expect(parsePartialJson('[1, 2,')).toEqual([1, 2])
  })

  it('cuts a half-written escape instead of failing', () => {
    expect(parsePartialJson('{"text": "a\\')).toEqual({ text: 'a' })
    expect(parsePartialJson('{"text": "a\\u00')).toEqual({ text: 'a' })
  })

  it('returns finished JSON as is, and nothing for empty or broken text', () => {
    expect(parsePartialJson('{"a":1}')).toEqual({ a: 1 })
    expect(parsePartialJson('')).toBeUndefined()
    expect(parsePartialJson('{"a": 1]')).toBeUndefined()
    expect(parsePartialJson('not json')).toBeUndefined()
  })
})
