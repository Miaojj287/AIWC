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
import { t } from '../i18n'

export interface ModelResolverDeps {
  config: () => AppConfig
  secrets: Pick<SecretStore, 'reveal'>
  /** Called by the composition root from config.subscribe to invalidate the cache. */
  logger?: Logger
}

export class ModelNotConfiguredError extends Error {
  readonly code = 'invalid_request' as const
  readonly retryable = false
  constructor(message = t('main.ai.notConfigured')) {
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
    if (!provider) throw new ModelNotConfiguredError(t('main.ai.providerNotFound', { provider: selection.providerId }))
    const model = provider.models.find((m) => m.modelId === selection.modelId)
    if (!model)
      throw new ModelNotConfiguredError(
        t('main.ai.modelNotFound', { provider: provider.label, model: selection.modelId }),
      )
    return { provider, model }
  }

  function clientFor(selection: ModelSelection): ModelClient {
    const key = `${selection.providerId}::${selection.modelId}`
    const hit = cache.get(key)
    if (hit) return hit
    const { provider, model } = find(selection)
    const apiKey = provider.apiKeyRef ? (deps.secrets.reveal(provider.apiKeyRef) ?? undefined) : undefined
    if (!apiKey && !isLocalProvider(provider)) {
      log.warn(`provider ${provider.id} has no usable API key (ref=${provider.apiKeyRef ?? 'none'})`)
    }
    const client = createAiSdkModelClient({ provider, model, apiKey })
    cache.set(key, client)
    return client
  }

  return {
    clientFor,
    invalidate: () => cache.clear(),
    async resolve(selection) {
      const cfg = deps.config()
      const provider = selection && cfg.ai.providers.find((p) => p.id === selection.providerId)
      const requested = selection && provider?.models.find((m) => m.modelId === selection.modelId)
      if (selection && requested && requested.enabled !== false && requested.available !== false)
        return clientFor(selection)
      // A thread pinned to a local model must never be silently moved to the (possibly online) default.
      if (provider && isLocalProvider(provider))
        throw new ModelNotConfiguredError(
          t('main.ai.modelNotFound', { provider: provider.label, model: selection?.modelId ?? '' }),
        )
      if (!cfg.ai.defaultModel) throw new ModelNotConfiguredError()
      return clientFor(cfg.ai.defaultModel)
    },
    async resolveAuxiliary(primary) {
      // No separate "cheap" model in config yet. A local thread keeps using its own local model; everything else
      // uses the default. Never route a local thread's content to an online provider.
      const cfg = deps.config()
      const provider = primary && cfg.ai.providers.find((p) => p.id === primary.providerId)
      if (primary && provider && isLocalProvider(provider)) return clientFor(primary)
      if (!cfg.ai.defaultModel) throw new ModelNotConfiguredError()
      return clientFor(cfg.ai.defaultModel)
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
