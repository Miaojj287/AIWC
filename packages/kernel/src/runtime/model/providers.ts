/**
 * Provider construction for the AI SDK adapter. Ollama is an OpenAI-compatible endpoint on localhost.
 */
import type { ModelEntry, ModelRef, ProviderConfig } from '@aiwc/protocol'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1'

export function providerBaseUrl(provider: ProviderConfig): string | undefined {
  if (provider.kind === 'ollama') return `${(provider.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`
  if (provider.kind === 'anthropic') return `${(provider.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`
  return provider.baseUrl?.replace(/\/+$/, '')
}

export function createLanguageModel(provider: ProviderConfig, modelId: string, apiKey?: string): LanguageModel {
  const baseURL = providerBaseUrl(provider)
  switch (provider.kind) {
    case 'openai': {
      const client = createOpenAI({ baseURL, apiKey })
      return /^(?:gpt-[5-9]|o[134](?:-|$)|codex-)/.test(modelId) ? client.responses(modelId) : client.chat(modelId)
    }
    case 'anthropic':
      return createAnthropic({ baseURL, apiKey }).languageModel(modelId)
    case 'google':
      return createGoogle({ baseURL, apiKey }).languageModel(modelId)
    case 'openai-compatible':
    case 'ollama': {
      if (!baseURL) throw new Error(`provider ${provider.id}: baseUrl is required for ${provider.kind}`)
      return createOpenAICompatible({ name: provider.id, baseURL, apiKey: apiKey ?? (provider.kind === 'ollama' ? 'ollama' : undefined) }).chatModel(
        modelId,
      )
    }
  }
}

export function toModelRef(provider: ProviderConfig, model: ModelEntry): ModelRef {
  const local = provider.kind === 'ollama' || isLoopback(providerBaseUrl(provider))
  return {
    providerId: provider.id,
    modelId: model.modelId,
    label: model.label,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
    local,
  }
}

export function isLoopback(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0'
  } catch {
    return false
  }
}
