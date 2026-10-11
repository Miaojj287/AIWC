/** Shared by the settings UI and request adapter. Unknown models use provider defaults.
 * Profiles describe capabilities only; available model IDs always come from the user's endpoint.
 * API metadata takes precedence over these documented compatibility profiles.
 */
import type { ModelCapabilities, ModelEntry, ProviderConfig, ReasoningEffort } from './config'
import { compatProfileCapabilities } from './modelProfiles'

/** Kind decides the request format; vendor / base URL pick the OpenAI-compatible dialect (modelProfiles.ts). */
export type CapabilityProvider = Pick<ProviderConfig, 'kind'> & Partial<Pick<ProviderConfig, 'vendor' | 'baseUrl'>>

export function modelCapabilities(
  provider: CapabilityProvider,
  model: Pick<ModelEntry, 'modelId' | 'capabilities'>,
): ModelCapabilities {
  // Stored capabilities from an older build that knew nothing about the model fall through to today's profiles.
  if (model.capabilities && model.capabilities.source !== 'unknown') return model.capabilities
  const id = model.modelId.toLowerCase().replace(/^models\//, '')
  const c: ModelCapabilities = { reasoning: [], thinking: 'none', fast: false, temperature: false, source: 'unknown' }
  if (provider.kind === 'openai-compatible' || provider.kind === 'ollama')
    return compatProfileCapabilities(provider, model.modelId) ?? model.capabilities ?? c
  const levels: ReasoningEffort[] = ['low', 'medium', 'high']
  if (provider.kind === 'openai') {
    if (/^gpt-(4(?:\.|o|-)|3\.5)/.test(id)) Object.assign(c, { source: 'profile', temperature: true })
    if (/^gpt-5(?:-|$)/.test(id) && !/chat|codex/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'effort',
        reasoning: id.includes('-pro') ? ['high'] : ['minimal', ...levels],
        contextLimit: 400_000,
        outputLimit: 128_000,
      })
    if (/^gpt-5\.1(?:-|$)/.test(id) && !/chat|codex/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'effort',
        reasoning: ['off', ...levels],
        contextLimit: 400_000,
        outputLimit: 128_000,
      })
    if (/^gpt-5\.[2456](?:-|$)/.test(id) && !/chat|codex/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'effort',
        reasoning: [
          ...(id.includes('-pro') ? ['medium', 'high'] : ['off', ...levels]),
          'xhigh',
          ...(id.startsWith('gpt-5.6') ? ['max'] : []),
        ],
        contextLimit: id.startsWith('gpt-5.2') ? 400_000 : 1_050_000,
        outputLimit: 128_000,
      })
    if (/^gpt-6-astra(?:-|$)/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'effort',
        reasoning: [...levels, 'xhigh', 'max'],
        contextLimit: 1_050_000,
        outputLimit: 128_000,
      })
    if (/^o[134](?:-|$)/.test(id) && !/pro|preview|deep-research/.test(id))
      Object.assign(c, { source: 'profile', thinking: 'effort', reasoning: levels })
  } else if (provider.kind === 'anthropic') {
    if (/^claude-(?:3-|sonnet-4|opus-4|haiku-4-5)/.test(id)) Object.assign(c, { source: 'profile', temperature: true })
    if (/^claude-(?:sonnet-4-6|opus-4-[678]|opus-5|sonnet-5|fable-5|mythos-)/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'adaptive',
        temperature: false,
        reasoning: [...levels, ...(/opus-4-6|sonnet-4-6/.test(id) ? [] : ['xhigh']), 'max'],
      })
    else if (/^claude-(?:3-7-sonnet|sonnet-4(?:-5)?|opus-4(?:-1|-5)?|haiku-4-5)(?:$|-\d{8}$)/.test(id))
      Object.assign(c, { thinking: 'budget', thinkingBudgetMin: 1024, thinkingBudgetMax: 32_000 })
    c.fast = /^claude-opus-(?:4-8|5)(?:-|$)/.test(id)
  } else if (provider.kind === 'google') {
    if (/^gemini-2\.5-(pro|flash)/.test(id) && !/image|audio|tts/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'budget',
        temperature: true,
        thinkingBudgetMin: id.includes('pro') ? 128 : id.includes('lite') ? 512 : 0,
        thinkingBudgetMax: id.includes('pro') ? 32_768 : 24_576,
      })
    if (/^gemini-3(?:\.[0-9]+)?-(pro|flash)/.test(id) && !/image|audio|tts/.test(id))
      Object.assign(c, {
        source: 'profile',
        thinking: 'effort',
        reasoning: /gemini-3-pro/.test(id) ? ['low', 'high'] : ['minimal', ...levels],
      })
  }
  return c
}

export function validModelSettings(provider: CapabilityProvider, model: ModelEntry): ModelEntry {
  const c = modelCapabilities(provider, model)
  return {
    ...model,
    reasoningEffort:
      model.reasoningEffort && c.reasoning.includes(model.reasoningEffort) ? model.reasoningEffort : undefined,
    fast: c.fast ? model.fast : undefined,
    thinkingBudget:
      c.thinking === 'budget' && model.thinkingBudget !== undefined
        ? Math.max(
            c.thinkingBudgetMin ?? 0,
            Math.min(model.thinkingBudget, c.thinkingBudgetMax ?? model.thinkingBudget),
          )
        : undefined,
    temperature: c.temperature ? model.temperature : undefined,
    contextWindow: Math.min(model.contextWindow, c.contextLimit ?? model.contextWindow),
    maxOutputTokens:
      model.maxOutputTokens === undefined
        ? undefined
        : Math.min(model.maxOutputTokens, c.outputLimit ?? model.maxOutputTokens),
  }
}

/** Context budget a new model starts with: its limit, capped (a 1M window is rarely worth the cost by default). */
export const DEFAULT_CONTEXT_BUDGET = 128_000

/**
 * 智能配置 on add / discover: fill the context budget and image input from the model's capabilities. Values the
 * user already set are kept (`keep`), so a re-sync never overrides an override.
 */
export function applyModelProfile(
  provider: CapabilityProvider,
  model: ModelEntry,
  keep?: Pick<ModelEntry, 'contextWindow' | 'supportsVision'>,
): ModelEntry {
  const c = modelCapabilities(provider, model)
  // Profile capabilities are not stored: they are recomputed per request, so a newer profile table applies.
  return {
    ...model,
    contextWindow: keep?.contextWindow ?? Math.min(c.contextLimit ?? model.contextWindow, DEFAULT_CONTEXT_BUDGET),
    supportsVision: keep?.supportsVision ?? c.vision ?? model.supportsVision,
  }
}
