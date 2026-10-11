/**
 * 智能配置 for OpenAI-compatible vendors (DeepSeek, Qwen / DashScope, Kimi, GLM, Doubao / Ark, MiniMax, SiliconFlow,
 * Hunyuan) and Ollama: context limit, image input and the thinking switch, keyed by vendor family + model id pattern,
 * and the request body that switch maps to. Documented vendor behaviour as of 2026-10; API metadata (Ollama
 * /api/show, `context_length` in a model list) wins over these profiles, and the user can override every value.
 */
import type { ModelCapabilities, ProviderConfig, ReasoningEffort } from './config'

export type CompatFamily =
  'deepseek' | 'qwen' | 'kimi' | 'glm' | 'doubao' | 'minimax' | 'siliconflow' | 'hunyuan' | 'ollama' | 'generic'

type ProviderLike = Pick<ProviderConfig, 'kind'> & Partial<Pick<ProviderConfig, 'vendor' | 'baseUrl'>>

/** Vendor preset ids (设置 › AI 接入) → family. */
const VENDOR_FAMILIES: Readonly<Record<string, CompatFamily>> = {
  deepseek: 'deepseek',
  qwen: 'qwen',
  kimi: 'kimi',
  glm: 'glm',
  seed: 'doubao',
  minimax: 'minimax',
  siliconflow: 'siliconflow',
  hunyuan: 'hunyuan',
  ollama: 'ollama',
}

/** Endpoint host → family, for providers configured by hand. */
const HOST_FAMILIES: ReadonlyArray<readonly [RegExp, CompatFamily]> = [
  [/(?:^|\.)deepseek\.com$/, 'deepseek'],
  [/(?:^|\.)aliyuncs\.com$/, 'qwen'],
  [/(?:^|\.)moonshot\.(?:cn|ai)$/, 'kimi'],
  [/(?:^|\.)(?:bigmodel\.cn|z\.ai)$/, 'glm'],
  [/(?:^|\.)volces\.com$/, 'doubao'],
  [/(?:^|\.)minimaxi?\.(?:com|io|chat)$/, 'minimax'],
  [/(?:^|\.)siliconflow\.(?:cn|com)$/, 'siliconflow'],
  [/(?:^|\.)(?:hunyuan\.cloud\.tencent\.com|tencentcloudapi\.com)$/, 'hunyuan'],
]

/** Which request dialect an OpenAI-compatible endpoint speaks for thinking / vision. */
export function compatFamily(provider: ProviderLike): CompatFamily {
  if (provider.kind === 'ollama') return 'ollama'
  if (provider.kind !== 'openai-compatible') return 'generic'
  const byVendor = provider.vendor ? VENDOR_FAMILIES[provider.vendor] : undefined
  if (byVendor) return byVendor
  if (!provider.baseUrl) return 'generic'
  try {
    const host = new URL(provider.baseUrl).hostname.toLowerCase()
    return HOST_FAMILIES.find(([re]) => re.test(host))?.[1] ?? 'generic'
  } catch {
    return 'generic'
  }
}

/** How a model's thinking is switched: never / always on / on-off / on-off with depth levels. */
type ThinkingMode = 'none' | 'always' | 'toggle' | 'levels'

interface Profile {
  match: RegExp
  context?: number
  output?: number
  vision?: boolean
  thinking?: ThinkingMode
}

const K = 1024
const TOGGLE: ReasoningEffort[] = ['off', 'high']
const LEVELS: ReasoningEffort[] = ['off', 'low', 'medium', 'high']

// First match wins inside a family. Ids are lower-cased, a `models/` or `org/` prefix removed.
const PROFILES: Readonly<Record<Exclude<CompatFamily, 'generic' | 'siliconflow'>, readonly Profile[]>> = {
  deepseek: [
    { match: /^deepseek-reasoner/, context: 128 * K, output: 64 * K, thinking: 'always' },
    { match: /^deepseek-chat/, context: 128 * K, output: 8 * K, thinking: 'toggle' },
    { match: /^deepseek-r1/, context: 128 * K, thinking: 'always' },
    { match: /^deepseek-v3[.-][12]/, context: 128 * K, thinking: 'toggle' },
    { match: /^deepseek/, context: 128 * K },
  ],
  qwen: [
    { match: /^(?:qvq|qwq)/, context: 128 * K, vision: true, thinking: 'always' },
    { match: /^qwen3-vl-(?:plus|flash)/, context: 256 * K, vision: true, thinking: 'levels' },
    { match: /(?:^qwen[\d.]*-vl|-vl-|^qwen[\d.]*-omni)/, context: 128 * K, vision: true },
    { match: /^qwen3-coder/, context: 1000 * K },
    { match: /^qwen3-max/, context: 256 * K, output: 64 * K },
    { match: /^qwen-max/, context: 32 * K, output: 8 * K },
    { match: /^qwen-long/, context: 10_000 * K },
    { match: /^qwen-(?:plus|flash|turbo)/, context: 1000 * K, output: 32 * K, thinking: 'levels' },
    { match: /^qwen3-.*-thinking/, context: 128 * K, thinking: 'always' },
    { match: /^qwen3-.*-instruct/, context: 256 * K },
    { match: /^qwen3-/, context: 128 * K, thinking: 'levels' },
    { match: /^qwen/, context: 128 * K },
  ],
  kimi: [
    { match: /^kimi-k2[.-]?5/, context: 256 * K, vision: true, thinking: 'toggle' },
    { match: /(?:^kimi-k2-thinking|^kimi-thinking)/, context: 256 * K, thinking: 'always' },
    { match: /^kimi-k2-0711/, context: 128 * K },
    { match: /^kimi-k2/, context: 256 * K },
    { match: /^kimi-latest/, context: 128 * K, vision: true },
    { match: /^moonshot-v1-8k/, context: 8 * K },
    { match: /^moonshot-v1-32k/, context: 32 * K },
    { match: /^moonshot-v1-128k/, context: 128 * K },
  ],
  glm: [
    { match: /^glm-4\.5v/, context: 64 * K, vision: true, thinking: 'toggle' },
    { match: /^glm-(?:4\.6|4\.7|5)v/, context: 128 * K, vision: true, thinking: 'toggle' },
    { match: /^glm-4v/, context: 8 * K, vision: true },
    { match: /^glm-(?:4\.6|4\.7|5)/, context: 200 * K, output: 128 * K, thinking: 'toggle' },
    { match: /^glm-4\.5/, context: 128 * K, output: 96 * K, thinking: 'toggle' },
    { match: /^glm-z1/, context: 128 * K, thinking: 'always' },
    { match: /^glm-4-long/, context: 1000 * K },
    { match: /^glm-4/, context: 128 * K },
  ],
  doubao: [
    { match: /^doubao-seed-1[.-][68].*thinking/, context: 256 * K, vision: true, thinking: 'always' },
    { match: /^doubao-seed-1[.-][68]/, context: 256 * K, output: 32 * K, vision: true, thinking: 'toggle' },
    { match: /^doubao-seed-code/, context: 256 * K, vision: true },
    { match: /^doubao-1[.-]5-thinking/, context: 128 * K, thinking: 'always' },
    { match: /^doubao-1[.-]5-vision/, context: 32 * K, vision: true },
    { match: /^doubao-1[.-]5-.*-256k/, context: 256 * K },
    { match: /^doubao-1[.-]5-.*-32k/, context: 32 * K },
    { match: /^deepseek-v3[.-][12]/, context: 128 * K, thinking: 'toggle' },
    { match: /^deepseek-r1/, context: 128 * K, thinking: 'always' },
  ],
  minimax: [
    { match: /^minimax-m2/, context: 200 * K, output: 128 * K, thinking: 'always' },
    { match: /^minimax-m1/, context: 1000 * K, output: 40 * K, thinking: 'always' },
    { match: /^minimax-text-01/, context: 1000 * K },
    { match: /^abab/, context: 240 * K },
  ],
  hunyuan: [
    { match: /^hunyuan-t1/, context: 64 * K, thinking: 'always' },
    { match: /^hunyuan-a13b/, context: 256 * K, thinking: 'levels' },
    { match: /vision/, vision: true },
  ],
  ollama: [],
}

/** SiliconFlow hosts open models under `org/name`; the underlying model decides, its switch is `enable_thinking`. */
const SILICONFLOW_PROFILES: readonly Profile[] = [
  { match: /^deepseek-r1/, context: 128 * K, thinking: 'always' },
  { match: /^deepseek-v3[.-][12]/, context: 128 * K, thinking: 'levels' },
  { match: /^deepseek/, context: 128 * K },
  { match: /(?:qwen[\d.]*-vl|glm-4\.[56]v|deepseek-vl|-vl-)/, context: 128 * K, vision: true },
  { match: /^qwen3-.*-thinking/, context: 128 * K, thinking: 'always' },
  { match: /^qwen3-.*-instruct/, context: 256 * K },
  { match: /^qwen3-/, context: 128 * K, thinking: 'levels' },
  { match: /^qwq/, context: 128 * K, thinking: 'always' },
  { match: /^glm-(?:4\.6|4\.7|5)/, context: 200 * K, thinking: 'levels' },
  { match: /^glm-4\.5/, context: 128 * K, thinking: 'levels' },
  { match: /^glm-z1/, context: 128 * K, thinking: 'always' },
  { match: /^kimi-k2/, context: 256 * K },
  { match: /^minimax-m/, context: 1000 * K, thinking: 'always' },
  { match: /^hunyuan-a13b/, context: 128 * K, thinking: 'levels' },
]

/** Lower-cased id without a `models/` or `org/` prefix. */
export function bareModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^[^/]+\//, '')
}

/** Context from a `-32k` / `-128k` suffix, image input from the usual vision markers. Last resort for any family. */
function heuristicProfile(id: string): Omit<Profile, 'match'> {
  const sized = /-(\d{1,4})k(?:\b|-|$)/.exec(id)
  const context = sized?.[1] ? Number(sized[1]) * K : undefined
  const vision = /(?:vision|-vl\b|-vl-|qvq|omni|llava|minicpm-v|gemma3)/.test(id) ? true : undefined
  return { context, vision }
}

function thinkingCapabilities(mode: ThinkingMode | undefined): Pick<ModelCapabilities, 'thinking' | 'reasoning'> {
  switch (mode) {
    case 'toggle':
      return { thinking: 'effort', reasoning: TOGGLE }
    case 'levels':
      return { thinking: 'effort', reasoning: LEVELS }
    case 'always':
    case 'none':
    case undefined:
      return { thinking: 'none', reasoning: [] }
  }
}

/**
 * Capabilities of an OpenAI-compatible or Ollama model from the profile table, or undefined when nothing is known.
 * Always-thinking models have no switch (reasoning: []); their temperature is left to the vendor.
 */
export function compatProfileCapabilities(provider: ProviderLike, modelId: string): ModelCapabilities | undefined {
  const family = compatFamily(provider)
  if (family === 'generic' && provider.kind !== 'openai-compatible') return undefined
  const id = bareModelId(modelId)
  const table = family === 'siliconflow' ? SILICONFLOW_PROFILES : family === 'generic' ? [] : PROFILES[family]
  const profile = table.find((p) => p.match.test(id))
  const guess = heuristicProfile(id)
  const context = profile?.context ?? guess.context
  const vision = profile?.vision ?? guess.vision
  if (!profile && context === undefined && vision === undefined) return undefined
  return {
    ...thinkingCapabilities(profile?.thinking),
    fast: false,
    temperature: profile?.thinking !== 'always',
    ...(context !== undefined ? { contextLimit: context } : {}),
    ...(profile?.output !== undefined ? { outputLimit: profile.output } : {}),
    ...(vision !== undefined ? { vision } : {}),
    source: 'profile',
  }
}

/** Ollama /api/show metadata → capabilities (API source). `thinking` comes from its `capabilities` list. */
export function ollamaCapabilities(
  modelId: string,
  show: { contextLength?: number; capabilities: readonly string[] },
): ModelCapabilities {
  const thinks = show.capabilities.includes('thinking')
  // gpt-oss cannot turn thinking off but takes low / medium / high; other thinking models only switch on and off.
  const reasoning: ReasoningEffort[] = !thinks ? [] : /^gpt-oss/.test(bareModelId(modelId)) ? LEVELS.slice(1) : TOGGLE
  return {
    thinking: reasoning.length ? 'effort' : 'none',
    reasoning,
    fast: false,
    temperature: true,
    ...(show.contextLength ? { contextLimit: show.contextLength } : {}),
    vision: show.capabilities.includes('vision'),
    source: 'api',
  }
}

/** Thinking budgets (tokens) behind 低 / 中 for vendors that take `thinking_budget`; 高 leaves the vendor's maximum. */
const THINKING_BUDGET: Partial<Record<ReasoningEffort, number>> = { minimal: 512, low: 2048, medium: 8192 }

/** Extra request fields for a chosen effort. `reasoningEffort` maps to `reasoning_effort` in the SDK. */
export interface CompatReasoningParams {
  body?: Record<string, unknown>
  reasoningEffort?: string
}

/** The request parameters that switch thinking for `family`; undefined = this family has no switch. */
export function compatReasoningParams(
  family: CompatFamily,
  effort: ReasoningEffort,
): CompatReasoningParams | undefined {
  const on = effort !== 'off'
  switch (family) {
    case 'deepseek':
    case 'glm':
    case 'kimi':
    case 'doubao':
      return { body: { thinking: { type: on ? 'enabled' : 'disabled' } } }
    case 'qwen':
    case 'siliconflow':
    case 'hunyuan': {
      const budget = THINKING_BUDGET[effort]
      return { body: { enable_thinking: on, ...(on && budget !== undefined ? { thinking_budget: budget } : {}) } }
    }
    case 'ollama':
      return { reasoningEffort: on ? effort : 'none' }
    case 'minimax':
    case 'generic':
      return undefined
  }
}
