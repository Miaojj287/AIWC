import { DEFAULT_HISTORY_COUNT, type AutoReplyRule } from '@aiwc/protocol'
import { describe, expect, it } from 'vitest'
import { clampHistoryCount, normaliseRule, validateRule } from './autoReplyRules'

const rule = (sessionId: string, extra: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: '',
  sessionId,
  enabled: true,
  source: 'ai',
  historyCount: DEFAULT_HISTORY_COUNT,
  updatedAt: 0,
  ...extra,
})

describe('auto-reply rule helpers', () => {
  it('assigns ids, trims text and stamps timestamps without mutating the input', () => {
    const input = rule('s1', { fixedText: '  ', prompt: '  你是我本人  ' })
    const out = normaliseRule(input, 123)
    expect(out.id).toMatch(/^rule_/)
    expect(out.fixedText).toBeUndefined()
    expect(out.prompt).toBe('你是我本人')
    expect(out.updatedAt).toBe(123)
    expect(input.id).toBe('')
    expect(normaliseRule(rule('s1', { id: 'rule_keep' })).id).toBe('rule_keep')
  })

  it('clamps historyCount into the supported range rather than rejecting the save', () => {
    expect(normaliseRule(rule('s1', { historyCount: 0 })).historyCount).toBe(1)
    expect(normaliseRule(rule('s1', { historyCount: 9999 })).historyCount).toBe(500)
    expect(clampHistoryCount(undefined)).toBe(DEFAULT_HISTORY_COUNT)
    expect(clampHistoryCount('40')).toBe(40)
  })

  it('validates the fields the form cannot express', () => {
    expect(validateRule(rule('s1'))).toBeUndefined()
    expect(validateRule(rule(''))).toBe('规则缺少会话')
    expect(validateRule(rule('s1', { source: 'fixed' }))).toMatch(/固定回复/)
    expect(validateRule(rule('s1', { source: 'fixed', fixedText: '稍后回复' }))).toBeUndefined()
    expect(validateRule(rule('s1', { historyCount: 0 }))).toMatch(/参考历史条数/)
    // A fixed rule never reads history, so its historyCount is not worth blocking a save over.
    expect(validateRule(rule('s1', { source: 'fixed', fixedText: 'hi', historyCount: 0 }))).toBeUndefined()
  })
})
