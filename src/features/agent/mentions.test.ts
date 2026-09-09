import { describe, expect, it } from 'vitest'
import { addMention, applyTrigger, buildUserInput, detectTrigger, matchesQuery, removeMention } from './mentions'

describe('detectTrigger', () => {
  it('finds an @ at the start and after whitespace, with the typed query', () => {
    expect(detectTrigger('@', 1)).toEqual({ kind: 'mention', start: 0, end: 1, query: '' })
    expect(detectTrigger('@产品', 3)).toEqual({ kind: 'mention', start: 0, end: 3, query: '产品' })
    expect(detectTrigger('总结 @产品市', 7)).toEqual({ kind: 'mention', start: 3, end: 7, query: '产品市' })
    expect(detectTrigger('总结\n@a', 5)).toEqual({ kind: 'mention', start: 3, end: 5, query: 'a' })
  })

  it('ignores @ glued to a word, e-mail-like text and whitespace after the trigger', () => {
    expect(detectTrigger('foo@bar', 7)).toBeUndefined()
    expect(detectTrigger('@产品 群', 5)).toBeUndefined()
    expect(detectTrigger('@产品 ', 4)).toBeUndefined()
  })

  it('only respects the caret position', () => {
    expect(detectTrigger('@产品市场群 帮我总结', 2)).toEqual({ kind: 'mention', start: 0, end: 2, query: '产' })
    expect(detectTrigger('@产品市场群 帮我总结', 10)).toBeUndefined()
  })

  it('treats / as a skill trigger only at the start of the message', () => {
    expect(detectTrigger('/', 1)).toEqual({ kind: 'skill', start: 0, end: 1, query: '' })
    expect(detectTrigger('/周', 2)).toEqual({ kind: 'skill', start: 0, end: 2, query: '周' })
    expect(detectTrigger('  /周', 4)).toEqual({ kind: 'skill', start: 2, end: 4, query: '周' })
    expect(detectTrigger('帮我 /周报', 5)).toBeUndefined()
    expect(detectTrigger('a/b', 3)).toBeUndefined()
  })
})

describe('applyTrigger', () => {
  it('removes the @query span when a chip is inserted', () => {
    const trigger = detectTrigger('总结 @产品 今天', 6)!
    expect(applyTrigger('总结 @产品 今天', trigger, '')).toEqual({ text: '总结  今天', caret: 3 })
  })
  it('replaces /query with the skill command and a trailing space', () => {
    const trigger = detectTrigger('/周', 2)!
    expect(applyTrigger('/周', trigger, '/周报 ')).toEqual({ text: '/周报 ', caret: 4 })
  })
})

describe('mention list helpers', () => {
  const a = { kind: 'session' as const, id: 's1', label: '产品市场群' }
  const b = { kind: 'file' as const, id: '/tmp/a.md', label: 'a.md' }
  it('deduplicates by kind + id and removes by key', () => {
    const list = addMention(addMention(addMention([], a), b), { ...a, label: '别名' })
    expect(list).toEqual([a, b])
    expect(removeMention(list, a)).toEqual([b])
    expect(removeMention(list, { kind: 'contact', id: 's1' })).toEqual([a, b])
  })
  it('matchesQuery is case-insensitive and empty matches everything', () => {
    expect(matchesQuery('', 'x')).toBe(true)
    expect(matchesQuery('ABC', 'xabcx')).toBe(true)
    expect(matchesQuery('产品', undefined, '产品市场群')).toBe(true)
    expect(matchesQuery('zz', 'abc')).toBe(false)
  })
})

describe('buildUserInput', () => {
  it('trims text and copies mentions; empty drafts are undefined', () => {
    expect(buildUserInput('  ', [])).toBeUndefined()
    const m = [{ kind: 'session' as const, id: 's1', label: 'g' }]
    expect(buildUserInput(' 总结 ', m)).toEqual({ content: [{ type: 'text', text: '总结' }], mentions: m })
    expect(buildUserInput('', m)).toEqual({ content: [{ type: 'text', text: '' }], mentions: m })
  })
})
