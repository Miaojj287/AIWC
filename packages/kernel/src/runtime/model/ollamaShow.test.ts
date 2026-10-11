import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '@aiwc/protocol'
import { parseOllamaShow } from './ollamaShow'
import { discoverModels } from './probe'

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })

describe('Ollama /api/show', () => {
  it('reads the architecture-prefixed context length and the capability list', () => {
    expect(
      parseOllamaShow({
        model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 },
        capabilities: ['completion', 'tools', 'thinking'],
      }),
    ).toEqual({ contextLength: 40960, capabilities: ['completion', 'tools', 'thinking'] })
    expect(parseOllamaShow({})).toEqual({ contextLength: undefined, capabilities: [] })
  })

  it('fills vision, tools, thinking and context during discovery', async () => {
    const provider: ProviderConfig = { id: 'ollama', label: 'Ollama', kind: 'ollama', models: [] }
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/api/tags')) return json({ models: [{ name: 'gemma3:4b' }, { name: 'qwen3:8b' }] })
      const model = (JSON.parse(String(init?.body)) as { model: string }).model
      return model === 'gemma3:4b'
        ? json({
            model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 131072 },
            capabilities: ['completion', 'vision'],
          })
        : json({
            model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 },
            capabilities: ['completion', 'tools', 'thinking'],
          })
    })
    const models = await discoverModels({ provider, fetchImpl })
    const gemma = models.find((m) => m.modelId === 'gemma3:4b')
    const qwen = models.find((m) => m.modelId === 'qwen3:8b')
    expect(gemma).toMatchObject({ supportsVision: true, supportsTools: false, contextWindow: 128_000 })
    expect(qwen).toMatchObject({ supportsVision: false, supportsTools: true, contextWindow: 40960 })
    expect(qwen?.capabilities).toMatchObject({ reasoning: ['off', 'high'], contextLimit: 40960, source: 'api' })
  })
})
