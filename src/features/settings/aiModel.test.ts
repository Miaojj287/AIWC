import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '@aiwc/protocol'
import { applyDraft, draftDirty, draftFromProvider, effortLabel, filterSuggestions, formatContext, isDraftValid, mergeModels, modelEntryFromId, modelOptions, modelValue, newProvider, parseModelValue, patchModel, providerFromVendor, providerStatus, removeModel, resolveDefaultModel, testStateFromResult, testStatusLine, upsertProvider, validateModelDraft } from './aiModel'
import { vendorById } from './vendors'

const provider: ProviderConfig = {
  id: 'p1',
  kind: 'openai',
  label: 'OpenAI 兼容',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'provider:p1:apiKey',
  models: [{ modelId: 'gpt-4.1', label: 'GPT-4.1', contextWindow: 128_000, supportsTools: true, supportsVision: true, enabled: true }],
}

describe('model draft', () => {
  it('round-trips a provider and detects dirtiness', () => {
    const d = draftFromProvider(provider)
    expect(d).toEqual({ kind: 'openai', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1', apiKey: '' })
    expect(draftDirty(provider, d)).toBe(false)
    expect(draftDirty(provider, { ...d, apiKey: 'sk-x' })).toBe(true)
    expect(draftDirty(provider, { ...d, modelId: ' gpt-4.1 ' })).toBe(false)
  })
  it('validates url / model / key depending on kind and stored key', () => {
    const d = draftFromProvider(provider)
    expect(isDraftValid(validateModelDraft(d, true))).toBe(true)
    expect(validateModelDraft(d, false).apiKey).toBe('请填写 API Key')
    expect(validateModelDraft({ ...d, baseUrl: 'api.openai.com' }, true).baseUrl).toMatch(/http/)
    expect(validateModelDraft({ ...d, modelId: '' }, true).modelId).toBe('请填写模型 ID')
    expect(validateModelDraft({ kind: 'ollama', baseUrl: '', modelId: 'qwen3:8b', apiKey: '' }, false).baseUrl).toBe('请填写接口 URL')
    expect(isDraftValid(validateModelDraft({ kind: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b', apiKey: '' }, false))).toBe(true)
    expect(isDraftValid(validateModelDraft({ kind: 'anthropic', baseUrl: '', modelId: 'claude', apiKey: 'k' }, false))).toBe(true)
  })
  it('applies the draft keeping other models and pinning the primary first', () => {
    const next = applyDraft({ ...provider, models: [...provider.models, { modelId: 'o4-mini', label: 'o4', contextWindow: 200_000, supportsTools: true, supportsVision: false, enabled: true }] }, { kind: 'openai', baseUrl: ' https://x.example/v1 ', modelId: 'o4-mini', apiKey: '' }, { supportsTools: false })
    expect(next.baseUrl).toBe('https://x.example/v1')
    expect(next.models.map((m) => m.modelId)).toEqual(['o4-mini', 'gpt-4.1'])
    expect(next.models[0]?.supportsTools).toBe(false)
    const fresh = applyDraft(newProvider('anthropic', 'a1'), { kind: 'anthropic', baseUrl: '', modelId: 'claude-sonnet-4-5', apiKey: 'k' }, { apiKeyRef: 'provider:a1:apiKey' })
    expect(fresh.baseUrl).toBe('https://api.anthropic.com')
    expect(fresh.apiKeyRef).toBe('provider:a1:apiKey')
    expect(fresh.models[0]).toMatchObject({ modelId: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' })
  })
})

describe('test status', () => {
  it('maps results to copy', () => {
    expect(testStatusLine(testStateFromResult({ ok: true, latencyMs: 420, supportsTools: true }))).toEqual({ kind: 'success', text: '已连接 · 延迟 420 ms · 支持工具调用' })
    expect(testStatusLine(testStateFromResult({ ok: true, latencyMs: 90, supportsTools: false })).kind).toBe('warning')
    expect(testStatusLine(testStateFromResult({ ok: true, supportsTools: false }), 'stt')).toEqual({ kind: 'success', text: '已连接' })
    const err = testStatusLine(testStateFromResult({ ok: false, error: { code: 'auth', message: 'bad key', status: 401, retryable: false } }))
    expect(err).toEqual({ kind: 'error', text: '鉴权失败 401：bad key' })
    expect(testStatusLine({ status: 'idle' }).text).toBe('尚未测试')
  })
})

describe('model options', () => {
  it('flattens providers and round-trips the select value', () => {
    const opts = modelOptions([provider, { ...newProvider('ollama', 'o'), models: [{ modelId: 'qwen3:8b', label: 'Qwen3 8B', contextWindow: 32_000, supportsTools: false, supportsVision: false, enabled: true }] }])
    expect(opts).toHaveLength(2)
    expect(opts[1]).toMatchObject({ local: true, description: 'Ollama · 本地 · 不支持工具调用' })
    expect(parseModelValue(modelValue({ providerId: 'p1', modelId: 'gpt-4.1' }))).toEqual({ providerId: 'p1', modelId: 'gpt-4.1' })
    expect(parseModelValue('nope')).toBeUndefined()
    expect(parseModelValue(undefined)).toBeUndefined()
  })
  it('filters suggestions with exact matches first', () => {
    expect(filterSuggestions(['hy3-pro', 'hy3', 'gpt'], 'hy3')).toEqual(['hy3', 'hy3-pro'])
    expect(filterSuggestions(['a', 'b'], '')).toEqual(['a', 'b'])
    expect(filterSuggestions(['a', 'b', 'c'], '', 2)).toHaveLength(2)
  })
})

describe('vendor / provider list helpers', () => {
  it('derives the status dot from the last test, then from a stored key or a local kind', () => {
    const glm = providerFromVendor(vendorById('glm')!)
    expect(providerStatus(undefined)).toBe('unconfigured')
    expect(providerStatus(glm)).toBe('unconfigured')
    expect(providerStatus({ ...glm, apiKeyRef: 'provider:glm:apiKey' })).toBe('ready')
    expect(providerStatus({ ...glm, apiKeyRef: 'x', lastTest: { ok: true, at: 1 } })).toBe('ok')
    expect(providerStatus({ ...glm, apiKeyRef: 'x', lastTest: { ok: false, at: 1, message: 'bad key' } })).toBe('error')
    expect(providerStatus(providerFromVendor(vendorById('ollama')!))).toBe('ready')
    expect(glm.id).toBe('glm')
    expect(glm.models).toEqual([])
  })
  it('keeps per-model settings when the selected model list changes', () => {
    const existing = [{ ...modelEntryFromId('a'), reasoningEffort: 'high' as const, enabled: false, contextWindow: 64_000 }]
    const merged = mergeModels(existing, [modelEntryFromId('b'), { ...modelEntryFromId('a'), description: 'preset note' }])
    expect(merged.map((m) => m.modelId)).toEqual(['b', 'a'])
    expect(merged[1]).toMatchObject({ reasoningEffort: 'high', enabled: false, contextWindow: 64_000, description: 'preset note' })
  })
  it('re-resolves the default model when it is disabled or removed', () => {
    const p: ProviderConfig = { ...provider, models: [{ ...provider.models[0]!, enabled: false }, modelEntryFromId('o4-mini')] }
    expect(resolveDefaultModel([p], { providerId: 'p1', modelId: 'gpt-4.1' })).toEqual({ providerId: 'p1', modelId: 'o4-mini' })
    expect(resolveDefaultModel([p], { providerId: 'p1', modelId: 'o4-mini' })).toEqual({ providerId: 'p1', modelId: 'o4-mini' })
    expect(resolveDefaultModel([], { providerId: 'p1', modelId: 'o4-mini' })).toBeUndefined()
    expect(modelOptions([p]).map((o) => o.label)).toEqual(['o4-mini'])
  })
  it('formats context windows and effort labels', () => {
    expect([32_000, 128_000, 200_000, 1_000_000].map(formatContext)).toEqual(['32k', '128k', '200k', '1M'])
    expect(effortLabel('medium')).toBe('中')
    expect(effortLabel(undefined)).toBeUndefined()
    expect(patchModel(provider, 'gpt-4.1', { fast: true }).models[0]?.fast).toBe(true)
    expect(removeModel(provider, 'gpt-4.1').models).toEqual([])
    expect(upsertProvider([provider], { ...provider, label: 'x' })[0]?.label).toBe('x')
    expect(upsertProvider([], provider)).toHaveLength(1)
  })
})

describe('live catalogue merging', () => {
  it('updates capability metadata, preserves user choices, and excludes missing remote models', async () => {
    const { syncProviderModels } = await import('./aiModel')
    const p: ProviderConfig = { ...provider, models: [
      { ...modelEntryFromId('old'), source: 'remote', enabled: true },
      { ...modelEntryFromId('gpt-5.4'), source: 'remote', enabled: false, contextWindow: 64_000, reasoningEffort: 'high' },
      modelEntryFromId('private-deployment'),
    ] }
    const remote = [{ ...modelEntryFromId('gpt-5.4'), source: 'remote' as const, available: true }, { ...modelEntryFromId('new'), source: 'remote' as const, available: true }]
    const next = syncProviderModels(p, remote)
    expect(next.models.find(m => m.modelId === 'gpt-5.4')).toMatchObject({ enabled: false, contextWindow: 64_000, reasoningEffort: 'high' })
    expect(next.models.find(m => m.modelId === 'old')?.available).toBe(false)
    expect(modelOptions([next]).map(m => m.label)).toEqual(['private-deployment'])
    expect(resolveDefaultModel([next], { providerId: p.id, modelId: 'old' })?.modelId).toBe('private-deployment')
    expect(next.modelsSyncedAt).toBeGreaterThan(0)
    expect(syncProviderModels(removeModel(next, 'gpt-5.4'), remote).models.some(m => m.modelId === 'gpt-5.4')).toBe(false)
  })
})
