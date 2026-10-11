import { describe, expect, it } from 'vitest'
import { applyModelProfile, modelCapabilities } from './modelCapabilities'
import { compatFamily, compatReasoningParams, ollamaCapabilities } from './modelProfiles'
import type { ModelEntry } from './config'

const entry = (modelId: string): ModelEntry => ({
  modelId,
  label: modelId,
  contextWindow: 128_000,
  supportsTools: true,
  supportsVision: false,
  enabled: true,
})

describe('compatible vendor families', () => {
  it('comes from the vendor preset or the endpoint host', () => {
    expect(compatFamily({ kind: 'openai-compatible', vendor: 'seed' })).toBe('doubao')
    expect(compatFamily({ kind: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/v1' })).toBe('qwen')
    expect(compatFamily({ kind: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1' })).toBe('siliconflow')
    expect(compatFamily({ kind: 'openai-compatible', baseUrl: 'https://gateway.example.com/v1' })).toBe('generic')
    expect(compatFamily({ kind: 'ollama' })).toBe('ollama')
    expect(compatFamily({ kind: 'openai' })).toBe('generic')
  })
})

describe('智能配置 profiles', () => {
  it('fills context, image input and the thinking switch for Chinese vendors', () => {
    const kimi = modelCapabilities({ kind: 'openai-compatible', vendor: 'kimi' }, { modelId: 'kimi-k2.5' })
    expect(kimi).toMatchObject({ contextLimit: 262_144, vision: true, reasoning: ['off', 'high'], source: 'profile' })
    const reasoner = modelCapabilities(
      { kind: 'openai-compatible', vendor: 'deepseek' },
      { modelId: 'deepseek-reasoner' },
    )
    expect(reasoner.reasoning).toEqual([])
    const qwen = modelCapabilities({ kind: 'openai-compatible', vendor: 'qwen' }, { modelId: 'qwen-plus-latest' })
    expect(qwen.reasoning).toEqual(['off', 'low', 'medium', 'high'])
    const sf = modelCapabilities(
      { kind: 'openai-compatible', vendor: 'siliconflow' },
      { modelId: 'Qwen/Qwen2.5-VL-72B-Instruct' },
    )
    expect(sf.vision).toBe(true)
  })

  it('falls back to id heuristics and leaves unknown models unknown', () => {
    const moonshot = modelCapabilities(
      { kind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1' },
      { modelId: 'moonshot-v1-32k-vision-preview' },
    )
    expect(moonshot).toMatchObject({ contextLimit: 32_768, vision: true })
    expect(modelCapabilities({ kind: 'openai-compatible' }, { modelId: 'my-model' }).source).toBe('unknown')
  })

  it('applies context and vision on add, keeping what the user set', () => {
    const glm = { kind: 'openai-compatible' as const, vendor: 'glm' }
    expect(applyModelProfile(glm, entry('glm-4.5v'))).toMatchObject({ supportsVision: true, contextWindow: 65_536 })
    expect(applyModelProfile(glm, entry('glm-4.5v'), { contextWindow: 32_000, supportsVision: false })).toMatchObject({
      supportsVision: false,
      contextWindow: 32_000,
    })
  })

  it('reads Ollama capabilities from /api/show', () => {
    expect(ollamaCapabilities('gpt-oss:20b', { capabilities: ['completion', 'tools', 'thinking'] }).reasoning).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(ollamaCapabilities('llava:7b', { contextLength: 4096, capabilities: ['vision'] })).toMatchObject({
      vision: true,
      contextLimit: 4096,
      reasoning: [],
    })
  })
})

describe('thinking request parameters', () => {
  it('speaks each vendor dialect', () => {
    expect(compatReasoningParams('glm', 'off')).toEqual({ body: { thinking: { type: 'disabled' } } })
    expect(compatReasoningParams('siliconflow', 'medium')).toEqual({
      body: { enable_thinking: true, thinking_budget: 8192 },
    })
    expect(compatReasoningParams('ollama', 'off')).toEqual({ reasoningEffort: 'none' })
    expect(compatReasoningParams('minimax', 'high')).toBeUndefined()
  })
})
