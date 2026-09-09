/**
 * ModelResolver for the kernel, built from config.ai + the secret store. Clients are cached per
 * provider/model and dropped whenever the AI config changes (new key, new base URL…).
 */
import type { AppConfig, ModelClient, ModelSelection, ProviderConfig } from '@aiwc/protocol'
import { createAiSdkModelClient } from '@aiwc/kernel'
import type { ModelResolverLike } from '../contracts'
import type { SecretStore } from '../config/secretStore'
import type { Logger } from '../log'
import { nullLogger } from '../log'

export interface ModelResolverDeps {
  config: () => AppConfig
  secrets: Pick<SecretStore, 'reveal'>
  /** Called by the composition root from config.subscribe to invalidate the cache. */
  logger?: Logger
}

export class ModelNotConfiguredError extends Error {
  readonly code = 'invalid_request' as const
  readonly retryable = false
  constructor(message = '尚未配置模型。请到「设置 › AI 接入」添加模型服务商并选择默认模型。') {
    super(message)
    this.name = 'ModelNotConfiguredError'
  }
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'host.docker.internal']

export function isLocalProvider(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): boolean {
  if (provider.kind === 'ollama') return true
  if (!provider.baseUrl) return false
  try {
    const host = new URL(provider.baseUrl).hostname.toLowerCase()
    return LOCAL_HOSTS.includes(host) || host.endsWith('.local') || host.endsWith('.lan')
  } catch {
    return false
  }
}

export function createModelResolver(deps: ModelResolverDeps): ModelResolverLike & { invalidate(): void } {
  const log = (deps.logger ?? nullLogger).child('models')
  const cache = new Map<string, ModelClient>()

  function find(selection: ModelSelection): { provider: ProviderConfig; model: ProviderConfig['models'][number] } {
    const cfg = deps.config()
    const provider = cfg.ai.providers.find((p) => p.id === selection.providerId)
    if (!provider) throw new ModelNotConfiguredError(`找不到模型服务商「${selection.providerId}」，请检查「设置 › AI 接入」。`)
    const model = provider.models.find((m) => m.modelId === selection.modelId)
    if (!model) throw new ModelNotConfiguredError(`服务商「${provider.label}」下没有模型「${selection.modelId}」。`)
    return { provider, model }
  }

  function clientFor(selection: ModelSelection): ModelClient {
    const key = `${selection.providerId}::${selection.modelId}`
    const hit = cache.get(key)
    if (hit) return hit
    const { provider, model } = find(selection)
    const apiKey = provider.apiKeyRef ? deps.secrets.reveal(provider.apiKeyRef) ?? undefined : undefined
    if (!apiKey && !isLocalProvider(provider)) {
      log.warn(`服务商 ${provider.id} 没有可用的 API Key（ref=${provider.apiKeyRef ?? '无'}）`)
    }
    const client = createAiSdkModelClient({ provider, model, apiKey })
    cache.set(key, client)
    return client
  }

  return {
    clientFor,
    invalidate: () => cache.clear(),
    async resolve(selection) {
      const requested = selection && deps.config().ai.providers.find(p => p.id === selection.providerId)?.models.find(m => m.modelId === selection.modelId)
      const sel = requested && requested.enabled !== false && requested.available !== false ? selection : deps.config().ai.defaultModel
      if (!sel) throw new ModelNotConfiguredError()
      return clientFor(sel)
    },
    async resolveAuxiliary() {
      // No separate "cheap" model in config yet: reuse the default. Kept as a seam for later.
      const sel = deps.config().ai.defaultModel
      if (!sel) throw new ModelNotConfiguredError()
      return clientFor(sel)
    },
    list() {
      const cfg = deps.config()
      return cfg.ai.providers.flatMap((p) =>
        p.models
          .filter((m) => m.enabled !== false && m.available !== false)
          .map((m) => ({
            providerId: p.id,
            modelId: m.modelId,
            label: m.label,
            providerLabel: p.label,
            vendor: p.vendor,
            contextWindow: m.contextWindow,
            local: isLocalProvider(p),
            supportsTools: m.supportsTools,
            reasoningEffort: m.reasoningEffort,
          })),
      )
    },
  }
}
