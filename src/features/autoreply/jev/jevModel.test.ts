import { describe, expect, it } from 'vitest'
import type { JevDecision } from '@aiwc/protocol'
import {
  addCandidate,
  canAddCandidate,
  chosenLabel,
  decisionOptions,
  decisionSummary,
  outcomeTone,
  percent,
  removeCandidate,
  setCandidate,
} from './jevModel'

const config = { candidates: ['a', 'b'], allowSilence: true, minConfidence: 0.6 }

const decision: JevDecision = {
  model: 'jev-1.13.0',
  choice: 'c2',
  confidence: 0.81,
  probabilities: { c1: 0.1, c2: 0.82, none: 0.08 },
  options: { c1: '好的收到', c2: '我晚点回你' },
  threshold: 0.6,
  outcome: 'send',
  latencyMs: 120,
}

describe('candidate edits', () => {
  it('adds, edits and removes candidates up to the cap', () => {
    expect(setCandidate(config, 1, 'c').candidates).toEqual(['a', 'c'])
    expect(addCandidate(config).candidates).toEqual(['a', 'b', ''])
    expect(removeCandidate(config, 0).candidates).toEqual(['b'])
    const full = { ...config, candidates: Array.from({ length: 8 }, () => 'x') }
    expect(canAddCandidate(full)).toBe(false)
    expect(addCandidate(full)).toBe(full)
  })
})

describe('decision display', () => {
  it('orders the options by probability and labels the silence option', () => {
    expect(decisionOptions(decision).map((o) => [o.label, percent(o.probability), o.chosen, o.silence])).toEqual([
      ['我晚点回你', 82, true, false],
      ['好的收到', 10, false, false],
      ['不回复', 8, false, true],
    ])
    expect(chosenLabel(decision)).toBe('我晚点回你')
    expect(chosenLabel({ ...decision, choice: 'none' })).toBe('不回复')
  })

  it('summarises a record line with the runner-ups', () => {
    expect(decisionSummary(decision)).toEqual({
      line: 'Jev 81% · 我晚点回你',
      others: '其他：好的收到 10% · 不回复 8%',
    })
    expect(outcomeTone('send')).toBe('ok')
    expect(outcomeTone('confirm')).toBe('warn')
    expect(outcomeTone('silence')).toBe('neutral')
    expect(percent(1.4)).toBe(100)
  })
})
