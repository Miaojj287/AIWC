/**
 * 首次引导 › 接入模型 — pure helpers. A provider connected from the wizard must leave a usable model behind (the
 * connect dialog adds models switched off, for the settings page where the user picks them).
 */
import type { ProviderConfig } from '@aiwc/protocol'

/** Turn on the first model the endpoint offers when none is on yet; otherwise return the provider unchanged. */
export function ensureEnabledModel(provider: ProviderConfig): ProviderConfig {
  if (provider.models.some((m) => m.enabled !== false && m.available !== false)) return provider
  const first = provider.models.find((m) => m.available !== false)
  if (!first) return provider
  return { ...provider, models: provider.models.map((m) => (m === first ? { ...m, enabled: true } : m)) }
}

/** The model the wizard tests: the first usable one. */
export function firstUsableModelId(provider: ProviderConfig): string | undefined {
  return provider.models.find((m) => m.enabled !== false && m.available !== false)?.modelId
}
