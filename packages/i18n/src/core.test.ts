import { describe, expect, it } from 'vitest'
import { formatMessage, leafKeys, lookup, placeholdersOf } from './core'

describe('formatMessage', () => {
  it('returns plain templates untouched', () => {
    expect(formatMessage('取消')).toBe('取消')
    expect(formatMessage('no params', { n: 1 })).toBe('no params')
  })

  it('interpolates named arguments and keeps missing ones visible', () => {
    expect(formatMessage('已复制 {what}', { what: '路径' })).toBe('已复制 路径')
    expect(formatMessage('{a} + {b}', { a: 1, b: 'x' })).toBe('1 + x')
    expect(formatMessage('Hello {name}', {})).toBe('Hello {name}')
  })

  it('selects plural branches with Intl.PluralRules and exact matches', () => {
    const en = '{n, plural, =0 {No messages} one {# message} other {# messages}}'
    expect(formatMessage(en, { n: 0 }, 'en-US')).toBe('No messages')
    expect(formatMessage(en, { n: 1 }, 'en-US')).toBe('1 message')
    expect(formatMessage(en, { n: 12 }, 'en-US')).toBe('12 messages')
    // Chinese has a single category: `other` is the only branch a zh template needs.
    expect(formatMessage('{n, plural, other {# 条消息}}', { n: 1 }, 'zh-CN')).toBe('1 条消息')
    expect(formatMessage('{n, plural, other {# 条消息}}', { n: 5 }, 'zh-CN')).toBe('5 条消息')
  })

  it('selects enum branches and falls back to other', () => {
    const t = '{kind, select, dm {单聊} group {群聊} other {会话}}'
    expect(formatMessage(t, { kind: 'dm' })).toBe('单聊')
    expect(formatMessage(t, { kind: 'group' })).toBe('群聊')
    expect(formatMessage(t, { kind: 'official' })).toBe('会话')
    expect(formatMessage(t, {})).toBe('会话')
  })

  it('nests arguments inside branches', () => {
    const t = '{n, plural, one {{name} sent # file} other {{name} sent # files}}'
    expect(formatMessage(t, { n: 2, name: 'Ann' }, 'en-US')).toBe('Ann sent 2 files')
  })

  it('rejects malformed templates loudly', () => {
    expect(() => formatMessage('{n, plural, one {x}}', { n: 1 })).toThrow(/other/)
    expect(() => formatMessage('{n, plural, one {x', { n: 1 })).toThrow()
    expect(() => formatMessage('{n, date, short}', { n: 1 })).toThrow(/unsupported/)
    expect(() => formatMessage('a } b', {})).not.toThrow() // a stray "}" outside an argument is plain text
  })
})

describe('lookup / leafKeys / placeholdersOf', () => {
  const tree = { common: { cancel: '取消', nested: { deep: 'x' } }, top: 'y' }

  it('walks dotted paths and refuses subtrees', () => {
    expect(lookup(tree, 'common.cancel')).toBe('取消')
    expect(lookup(tree, 'common.nested.deep')).toBe('x')
    expect(lookup(tree, 'top')).toBe('y')
    expect(lookup(tree, 'common')).toBeUndefined()
    expect(lookup(tree, 'common.missing')).toBeUndefined()
    expect(lookup(tree, 'top.deeper')).toBeUndefined()
  })

  it('lists sorted leaf keys and placeholder names', () => {
    expect(leafKeys(tree)).toEqual(['common.cancel', 'common.nested.deep', 'top'])
    expect(placeholdersOf('{n, plural, one {{name} # x} other {# y}} {z}')).toEqual(['n', 'name', 'z'])
    expect(placeholdersOf('plain')).toEqual([])
  })
})
