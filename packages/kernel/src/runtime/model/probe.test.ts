import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '@aiwc/protocol'
import { discoverModels, listRemoteModels, modelsEndpoint } from './probe'
import { providerBaseUrl } from './providers'
const p = (kind: ProviderConfig['kind'], baseUrl?: string): ProviderConfig => ({ id: 'test', label: 'test', kind, baseUrl, models: [] })
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })

describe('live model discovery', () => {
  it('normalizes Anthropic and Ollama base paths for discovery and inference', () => {
    expect(modelsEndpoint(p('anthropic', 'https://api.anthropic.com/'), 'key').url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(modelsEndpoint(p('anthropic', 'https://api.anthropic.com/v1'), 'key').headers).toMatchObject({ 'x-api-key': 'key' })
    expect(modelsEndpoint(p('ollama', 'http://localhost:11434/v1')).url).toBe('http://localhost:11434/api/tags')
    expect(providerBaseUrl(p('ollama', 'http://localhost:11434'))).toBe('http://localhost:11434/v1')
  })
  it('paginates Gemini, filters non-chat models and preserves token limits', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ models: [{ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next & token' })).mockResolvedValueOnce(json({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini Pro', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 }] }))
    const models = await discoverModels({ provider: p('google'), apiKey: 'secret', fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get('pageToken')).toBe('next & token')
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ modelId: 'gemini-2.5-pro', label: 'Gemini Pro', capabilities: { thinking: 'budget', contextLimit: 1_048_576, outputLimit: 65_536 } })
  })
  it('uses live Claude capabilities even for an unknown future ID and reads all pages', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: [{ id: 'claude-future', capabilities: { effort: { supported: true, low: { supported: true } }, thinking: { types: { adaptive: { supported: true } } } } }], has_more: true, last_id: 'claude-future' })).mockResolvedValueOnce(json({ data: [{ id: 'claude-old' }], has_more: false }))
    const models = await discoverModels({ provider: p('anthropic'), fetchImpl })
    expect(models).toHaveLength(2)
    expect(models[0]?.capabilities).toMatchObject({ reasoning: ['low'], thinking: 'adaptive', source: 'api' })
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('after_id=claude-future')
  })
  it.each(['anthropic', 'google'] as const)('does not hide %s authentication errors behind static models', async kind => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret upstream error', { status: 401 }))
    await expect(discoverModels({ provider: p(kind), fetchImpl })).rejects.toThrow('HTTP 401')
  })
  it('preserves empty results and rejects malformed or looping pages', async () => {
    expect(await listRemoteModels({ provider: p('anthropic'), fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json({ data: [] })) })).toEqual([])
    await expect(discoverModels({ provider: p('google'), fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => json({ models: [], nextPageToken: 'same' })) })).rejects.toThrow('分页异常')
    await expect(discoverModels({ provider: p('openai'), fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json({ unexpected: [] })) })).rejects.toThrow('有效的模型列表')
  })
  it('keeps speech IDs in the legacy picker while excluding non-chat IDs from Agent discovery', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => json({ data: [{ id: 'whisper-1' }, { id: 'gpt-5.4' }, { id: 'gpt-image-1' }, { id: 'text-embedding-3-small' }] }))
    expect(await listRemoteModels({ provider: p('openai'), fetchImpl })).toContain('whisper-1')
    expect((await discoverModels({ provider: p('openai'), fetchImpl })).map(m => m.modelId)).toEqual(['gpt-5.4'])
  })
})
