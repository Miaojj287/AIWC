import { describe, expect, it } from 'vitest'
import { providerOptionsFor } from './aiSdk'

describe('OpenAI-compatible thinking parameters per vendor family', () => {
  it('switches DeepSeek / GLM / Kimi / Doubao with `thinking.type`', () => {
    const deepseek = { kind: 'openai-compatible' as const, id: 'deepseek', vendor: 'deepseek' }
    expect(providerOptionsFor(deepseek, { modelId: 'deepseek-chat', reasoningEffort: 'high' })).toEqual({
      deepseek: { thinking: { type: 'enabled' } },
    })
    expect(providerOptionsFor(deepseek, { modelId: 'deepseek-chat', reasoningEffort: 'off' })).toEqual({
      deepseek: { thinking: { type: 'disabled' } },
    })
    // A hand-configured endpoint is recognised by its host.
    const glm = { kind: 'openai-compatible' as const, id: 'c1', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }
    expect(providerOptionsFor(glm, { modelId: 'glm-4.6', reasoningEffort: 'off' })).toEqual({
      c1: { thinking: { type: 'disabled' } },
    })
  })

  it('maps Qwen levels to enable_thinking + thinking_budget, and `lowest` turns thinking off', () => {
    const qwen = { kind: 'openai-compatible' as const, id: 'qwen', vendor: 'qwen' }
    expect(providerOptionsFor(qwen, { modelId: 'qwen-plus', reasoningEffort: 'low' })).toEqual({
      qwen: { enable_thinking: true, thinking_budget: 2048 },
    })
    expect(providerOptionsFor(qwen, { modelId: 'qwen-plus', reasoningEffort: 'high' })).toEqual({
      qwen: { enable_thinking: true },
    })
    expect(providerOptionsFor(qwen, { modelId: 'qwen-plus', reasoningEffort: 'high' }, 'lowest')).toEqual({
      qwen: { enable_thinking: false },
    })
  })

  it('sends nothing for always-thinking models or vendors without a switch', () => {
    const deepseek = { kind: 'openai-compatible' as const, id: 'deepseek', vendor: 'deepseek' }
    expect(providerOptionsFor(deepseek, { modelId: 'deepseek-reasoner', reasoningEffort: 'off' })).toBeUndefined()
    const minimax = { kind: 'openai-compatible' as const, id: 'minimax', vendor: 'minimax' }
    expect(providerOptionsFor(minimax, { modelId: 'MiniMax-M2', reasoningEffort: 'high' })).toBeUndefined()
  })

  it('uses reasoning_effort for Ollama thinking models', () => {
    const ollama = { kind: 'ollama' as const, id: 'ollama' }
    const capabilities = {
      thinking: 'effort' as const,
      reasoning: ['off' as const, 'high' as const],
      fast: false,
      temperature: true,
      source: 'api' as const,
    }
    expect(providerOptionsFor(ollama, { modelId: 'qwen3:8b', capabilities, reasoningEffort: 'off' })).toEqual({
      ollama: { reasoningEffort: 'none' },
    })
  })
})
