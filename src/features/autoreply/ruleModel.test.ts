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
  it('starts enabled, on AI, with the default history depth, parked behind 确认发送', () => {
    const r = newRule('s1')
    expect(r).toMatchObject({
      sessionId: 's1',
      enabled: true,
      source: 'ai',
      historyCount: DEFAULT_HISTORY_COUNT,
      sendMode: 'confirm',
    })
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
    expect(rulesEqual(base, { ...base, sendMode: 'auto' })).toBe(false)
  })
})

describe('ruleStatusLine / segments', () => {
  it('describes unset / paused / on rules', () => {
    expect(ruleStatusLine(undefined)).toEqual({ kind: 'unset', text: '未设置' })
    expect(ruleStatusLine(rule({ enabled: false }))).toMatchObject({ kind: 'paused', text: '已暂停' })
    expect(ruleStatusLine(rule({ enabled: false, pausedReason: '账户已切换' })).text).toBe('已暂停 · 账户已切换')
    // an enabled rule that the backend paused still reads as paused, with the reason
    expect(ruleStatusLine(rule({ pausedReason: '发送已熔断' })).text).toBe('已暂停 · 发送已熔断')
    expect(ruleStatusLine(rule({ historyCount: 50, todayCount: 3 })).text).toBe(
      '确认后发送 · AI 生成 · 参考 50 条 · 今日 3 次',
    )
    expect(ruleStatusLine(rule({ source: 'fixed', fixedText: 'hi', sendMode: 'auto' })).text).toBe(
      '自动发送 · 固定文案',
    )
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

  it('labels the three sources', () => {
    expect(sourceLabel('fixed')).toBe('固定文案')
    expect(sourceLabel('ai')).toBe('AI 生成')
    expect(sourceLabel('jev')).toBe('Jev（beta）')
  })
})

describe('Jev rules (回复方式 = Jev（beta）)', () => {
  const jev = (over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
    ...newRule('s1'),
    id: 'r1',
    source: 'jev',
    jev: { candidates: [], allowSilence: true, minConfidence: 0.6 },
    ...over,
  })

  it('validates the candidates only for the jev source', () => {
    expect(validateRule(jev()).candidates).toMatch(/至少/)
    expect(
      validateRule(jev({ jev: { candidates: ['好的', ''], allowSilence: true, minConfidence: 0.6 } })).candidates,
    ).toBeUndefined()
    expect(
      validateRule(
        jev({ jev: { candidates: Array.from({ length: 9 }, () => 'x'), allowSilence: true, minConfidence: 0.6 } }),
      ).candidates,
    ).toMatch(/最多 8/)
    expect(
      validateRule(jev({ jev: { candidates: ['x'.repeat(501)], allowSilence: true, minConfidence: 0.6 } })).candidates,
    ).toMatch(/500/)
    expect(validateRule(jev({ historyCount: 0 })).historyCount).toBeDefined()
    expect(validateRule(rule()).candidates).toBeUndefined()
  })

  it('compares the Jev fields when checking for unsaved edits', () => {
    const base = jev({ jev: { candidates: ['a'], allowSilence: true, minConfidence: 0.6 } })
    expect(rulesEqual(base, { ...base, updatedAt: 9 })).toBe(true)
    expect(rulesEqual(base, { ...base, jev: { candidates: ['b'], allowSilence: true, minConfidence: 0.6 } })).toBe(
      false,
    )
    expect(rulesEqual(base, { ...base, jev: { candidates: ['a'], allowSilence: false, minConfidence: 0.6 } })).toBe(
      false,
    )
    expect(rulesEqual(base, { ...base, jev: { candidates: ['a'], allowSilence: true, minConfidence: 0.8 } })).toBe(
      false,
    )
  })

  it('describes a Jev rule on the list row', () => {
    expect(ruleStatusLine(jev({ jev: { candidates: ['a', 'b'], allowSilence: true, minConfidence: 0.6 } })).text).toBe(
      '确认后发送 · Jev（beta） · 2 个候选 · 参考 30 条',
    )
  })
})
