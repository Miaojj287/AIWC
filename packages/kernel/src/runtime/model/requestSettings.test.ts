import { afterEach, describe, expect, it, vi } from 'vitest'
import { newItemId, asTurnId, type ModelEntry, type ProviderConfig } from '@aiwc/protocol'
import { createAiSdkModelClient } from './aiSdk'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function capture(kind: ProviderConfig['kind'], modelId: string, settings: Partial<ModelEntry>) {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // expected mocked HTTP 400
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'test capture complete' } }), { status: 400, headers: { 'content-type': 'application/json' } })
  }))
  const model: ModelEntry = { modelId, label: modelId, enabled: true, supportsTools: true, supportsVision: false, contextWindow: 128_000, ...settings }
  const client = createAiSdkModelClient({ provider: { id: 'test', label: 'test', kind, models: [model] }, model, apiKey: 'test-only-key' })
  for await (const _part of client.sample({ system: 'test', history: [{ type: 'user_message', id: newItemId(), turnId: asTurnId('test'), createdAt: 1, content: [{ type: 'text', text: 'test' }], mentions: [] }], tools: [], toolChoice: 'none', signal: new AbortController().signal })) { /* capture the serialized SDK request, no real network */ }
  expect(requests).toHaveLength(1)
  return requests[0]!
}

describe('serialized model requests', () => {
  it('routes newer OpenAI models to Responses with effort, output cap and storage disabled', async () => {
    const request = await capture('openai', 'gpt-5.4', { reasoningEffort: 'high', fast: true, temperature: 0.7, maxOutputTokens: 1000 })
    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.body).toMatchObject({ reasoning: { effort: 'high' }, max_output_tokens: 1000, store: false })
    expect(request.body).not.toHaveProperty('temperature')
    expect(request.body).not.toHaveProperty('service_tier')
  })
  it('keeps ordinary models on Chat Completions and omits unsupported reasoning', async () => {
    const request = await capture('openai', 'gpt-4.1', { reasoningEffort: 'high', temperature: 0.5 })
    expect(request.url).toContain('/chat/completions')
    expect(request.body).toMatchObject({ temperature: 0.5, store: false })
    expect(request.body).not.toHaveProperty('reasoning_effort')
  })
  it('serializes native Gemini thinking budgets', async () => {
    const request = await capture('google', 'gemini-2.5-pro', { thinkingBudget: 4096, temperature: 0.5 })
    expect(request.body).toMatchObject({ generationConfig: { temperature: 0.5, thinkingConfig: { thinkingBudget: 4096 } } })
  })
  it('serializes Claude fast mode with its required beta header', async () => {
    const request = await capture('anthropic', 'claude-opus-5', { fast: true, reasoningEffort: 'high' })
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.body).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, speed: 'fast' })
    expect(request.headers.get('anthropic-beta')).toContain('fast-mode-2026-02-01')
  })
})
