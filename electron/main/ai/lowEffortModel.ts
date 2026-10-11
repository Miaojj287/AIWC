/**
 * Clients for small background jobs (memory extraction): the thread's own model at the lowest reasoning effort
 * it supports, no fast mode. Model choice follows ModelResolver.resolve exactly — an unusable selection falls back
 * to the default model unless the selection is local, which is refused (a local thread's content never goes to an
 * online provider). Not cached: these calls are rare and the per-model client is cheap to build.
 */
import {
  modelCapabilities,
  type AppConfig,
  type ModelClient,
  type ModelEntry,
  type ModelSelection,
  type ProviderConfig,
} from '@aiwc/protocol'
import { createAiSdkModelClient } from '@aiwc/kernel'
import type { SecretStore } from '../config/secretStore'
import { ModelNotConfiguredError, isLocalProvider } from './modelResolver'
import { t } from '../i18n'

/** The model entry with reasoning turned down as far as its capabilities allow. */
export function lowestEffortSettings(provider: Pick<ProviderConfig, 'kind'>, model: ModelEntry): ModelEntry {
  const c = modelCapabilities(provider, model)
  return {
    ...model,
    // Capability lists run from least to most effort ('off' / 'minimal' first).
    reasoningEffort: c.reasoning[0],
    // A budget left unset sends no thinking option (Anthropic: off); Gemini's minimum is its own floor.
    thinkingBudget: c.thinking === 'budget' && provider.kind === 'google' ? (c.thinkingBudgetMin ?? 0) : undefined,
    fast: false,
  }
}

function pick(cfg: AppConfig, selection: ModelSelection | undefined): { provider: ProviderConfig; model: ModelEntry } {
  const provider = selection && cfg.ai.providers.find((p) => p.id === selection.providerId)
  const requested = selection && provider?.models.find((m) => m.modelId === selection.modelId)
  if (provider && requested && requested.enabled !== false && requested.available !== false)
    return { provider, model: requested }
  if (provider && isLocalProvider(provider))
    throw new ModelNotConfiguredError(
      t('main.ai.modelNotFound', { provider: provider.label, model: selection?.modelId ?? '' }),
    )
  const fallback = cfg.ai.defaultModel
  const defaultProvider = fallback && cfg.ai.providers.find((p) => p.id === fallback.providerId)
  const defaultModel = fallback && defaultProvider?.models.find((m) => m.modelId === fallback.modelId)
  if (!defaultProvider || !defaultModel) throw new ModelNotConfiguredError()
  return { provider: defaultProvider, model: defaultModel }
}

export function createLowEffortModelFactory(deps: {
  config: () => AppConfig
  secrets: Pick<SecretStore, 'reveal'>
  /** Same transport as the main resolver (proxy settings), when the host has one. */
  fetch?: typeof globalThis.fetch
}): (selection: ModelSelection | undefined) => Promise<ModelClient> {
  return async (selection) => {
    const { provider, model } = pick(deps.config(), selection)
    const apiKey = provider.apiKeyRef ? (deps.secrets.reveal(provider.apiKeyRef) ?? undefined) : undefined
    return createAiSdkModelClient({
      provider,
      model: lowestEffortSettings(provider, model),
      apiKey,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    })
  }
}
