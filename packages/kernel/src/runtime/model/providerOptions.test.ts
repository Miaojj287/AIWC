import { describe, expect, it } from 'vitest'
import { providerOptionsFor } from './aiSdk'

describe('capability-aware provider options', () => {
  it('omits unsupported and legacy settings for ordinary and unknown models', () => {
    for (const modelId of ['gpt-4.1', 'unknown-future-model']) {
      expect(providerOptionsFor({ kind: 'openai', id: 'p' }, { modelId, reasoningEffort: 'max', fast: true })).toBeUndefined()
    }
    expect(providerOptionsFor({ kind: 'openai-compatible', id: 'gateway' }, { modelId: 'gpt-5.4', reasoningEffort: 'high' })).toBeUndefined()
  })
  it('honors model-specific OpenAI effort ranges', () => {
    const p = { kind: 'openai' as const, id: 'p' }
    expect(providerOptionsFor(p, { modelId: 'gpt-5', reasoningEffort: 'off' })).toBeUndefined()
    expect(providerOptionsFor(p, { modelId: 'gpt-5-pro', reasoningEffort: 'low' })).toBeUndefined()
    expect(providerOptionsFor(p, { modelId: 'gpt-5.4', reasoningEffort: 'xhigh' })).toEqual({ openai: { reasoningEffort: 'xhigh' } })
    expect(providerOptionsFor(p, { modelId: 'gpt-5.6-sol', reasoningEffort: 'max' })).toEqual({ openai: { reasoningEffort: 'max' } })
  })
  it('sends adaptive thinking with Claude effort and restricts fast mode', () => {
    const p = { kind: 'anthropic' as const, id: 'p' }
    expect(providerOptionsFor(p, { modelId: 'claude-sonnet-4-6', reasoningEffort: 'high', fast: true })).toEqual({ anthropic: { effort: 'high', thinking: { type: 'adaptive' } } })
    expect(providerOptionsFor(p, { modelId: 'claude-opus-5', fast: true })).toEqual({ anthropic: { speed: 'fast' } })
    expect(providerOptionsFor(p, { modelId: 'claude-sonnet-4-5', thinkingBudget: 4000 })).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 4000 } } })
  })
  it('uses budgets for Gemini 2.5 and levels for Gemini 3', () => {
    const p = { kind: 'google' as const, id: 'p' }
    expect(providerOptionsFor(p, { modelId: 'gemini-2.5-pro', thinkingBudget: 0 })).toEqual({ google: { thinkingConfig: { thinkingBudget: 128 } } })
    expect(providerOptionsFor(p, { modelId: 'gemini-2.5-flash', thinkingBudget: 0 })).toEqual({ google: { thinkingConfig: { thinkingBudget: 0 } } })
    expect(providerOptionsFor(p, { modelId: 'gemini-3-pro-preview', reasoningEffort: 'medium' })).toBeUndefined()
    expect(providerOptionsFor(p, { modelId: 'gemini-3-flash-preview', reasoningEffort: 'minimal' })).toEqual({ google: { thinkingConfig: { thinkingLevel: 'minimal' } } })
  })
})
