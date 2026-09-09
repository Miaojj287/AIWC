import { describe, expect, it } from 'vitest'
import type { AutoReplyRule } from '@aiwc/protocol'
import {
  DEFAULT_HISTORY_COUNT,
  copyRuleTo,
  insertAtCursor,
  isRuleValid,
  matchesSegment,
  newRule,
  ruleStatusLine,
  rulesEqual,
  sourceLabel,
  validateRule,
} from './ruleModel'

const rule = (over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({ ...newRule('s1'), id: 'r1', ...over })

describe('newRule', () => {
  it('starts enabled, on AI, with the default history depth', () => {
    const r = newRule('s1')
    expect(r).toMatchObject({ sessionId: 's1', enabled: true, source: 'ai', historyCount: DEFAULT_HISTORY_COUNT })
    expect(r.id).toBe('')
  })
})

describe('validateRule', () => {
  it('requires fixed text only for the fixed source', () => {
    expect(isRuleValid(validateRule(rule()))).toBe(true)
    expect(validateRule(rule({ source: 'fixed' })).fixedText).toMatch(/不能为空/)
    expect(validateRule(rule({ source: 'fixed', fixedText: '稍后回复' })).fixedText).toBeUndefined()
  })

  it('requires a sane history depth only for the AI source', () => {
    expect(validateRule(rule({ historyCount: 0 })).historyCount).toMatch(/1 – 500/)
    expect(validateRule(rule({ historyCount: 501 })).historyCount).toMatch(/1 – 500/)
    expect(validateRule(rule({ historyCount: 12.5 })).historyCount).toBeDefined()
    expect(validateRule(rule({ historyCount: 200 })).historyCount).toBeUndefined()
    expect(validateRule(rule({ source: 'fixed', fixedText: 'hi', historyCount: 0 })).historyCount).toBeUndefined()
  })
})

describe('rulesEqual', () => {
  it('compares the edited fields and ignores derived bookkeeping', () => {
    const base = rule({ prompt: '你是我本人' })
    expect(rulesEqual(base, { ...base, todayCount: 9, updatedAt: 999, pausedReason: 'x' })).toBe(true)
    expect(rulesEqual(base, { ...base, prompt: '换个说法' })).toBe(false)
    expect(rulesEqual(base, { ...base, historyCount: 100 })).toBe(false)
    expect(rulesEqual(base, { ...base, enabled: false })).toBe(false)
  })
})

describe('ruleStatusLine / segments', () => {
  it('describes unset / paused / on rules', () => {
    expect(ruleStatusLine(undefined)).toEqual({ kind: 'unset', text: '未设置' })
    expect(ruleStatusLine(rule({ enabled: false }))).toMatchObject({ kind: 'paused', text: '已暂停' })
    expect(ruleStatusLine(rule({ enabled: false, pausedReason: '账户已切换' })).text).toBe('已暂停 · 账户已切换')
    // an enabled rule that the backend paused still reads as paused, with the reason
    expect(ruleStatusLine(rule({ pausedReason: '发送已熔断' })).text).toBe('已暂停 · 发送已熔断')
    expect(ruleStatusLine(rule({ historyCount: 50, todayCount: 3 })).text).toBe('已开启 · AI 生成 · 参考 50 条 · 今日 3 次')
    expect(ruleStatusLine(rule({ source: 'fixed', fixedText: 'hi' })).text).toBe('已开启 · 固定文案')
  })

  it('filters by segment', () => {
    expect(matchesSegment(undefined, 'all')).toBe(true)
    expect(matchesSegment(undefined, 'on')).toBe(false)
    expect(matchesSegment(rule(), 'on')).toBe(true)
    expect(matchesSegment(rule({ enabled: false }), 'paused')).toBe(true)
  })
})

describe('helpers', () => {
  it('inserts a variable at the caret and clamps out-of-range positions', () => {
    expect(insertAtCursor('你好世界', 2, '{昵称}')).toEqual({ text: '你好{昵称}世界', cursor: 6 })
    expect(insertAtCursor('abc', 99, 'X')).toEqual({ text: 'abcX', cursor: 4 })
  })

  it('copies a rule to another session as an unsaved rule', () => {
    const copy = copyRuleTo(rule({ todayCount: 4, pausedReason: 'x', prompt: 'p' }), 's2')
    expect(copy).toMatchObject({ id: '', sessionId: 's2', prompt: 'p', todayCount: undefined, pausedReason: undefined })
  })

  it('labels the two sources', () => {
    expect(sourceLabel('fixed')).toBe('固定文案')
    expect(sourceLabel('ai')).toBe('AI 生成')
  })
})
