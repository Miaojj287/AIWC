/**
 * AI 接入 helpers (DESIGN-SPEC §2): provider kinds, the ModelForm draft + validation, test-result copy
 * and the flattened model list used by 默认模型 / thread model pickers. Pure — tested in aiModel.test.ts.
 */
import { validModelSettings } from '@aiwc/protocol'
import type { ModelEntry, ModelSelection, ModelTestResult, ProviderConfig, ProviderKind, ReasoningEffort } from '@aiwc/protocol'
import { type VendorPreset } from './vendors'

export interface ProviderKindMeta {
  value: ProviderKind
  label: string
  description: string
  defaultBaseUrl: string
  /** Inference never leaves the machine (no key, 本地 badge). */
  local: boolean
}

export const PROVIDER_KINDS: readonly ProviderKindMeta[] = [
  { value: 'openai', label: 'OpenAI', description: 'Responses / Chat Completions · Bearer', defaultBaseUrl: 'https://api.openai.com/v1', local: false },
  { value: 'anthropic', label: 'Anthropic', description: '/v1/messages · x-api-key', defaultBaseUrl: 'https://api.anthropic.com', local: false },
  { value: 'google', label: 'Google Gemini', description: 'generateContent · key 参数', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', local: false },
  { value: 'openai-compatible', label: '自定义 · OpenAI 格式', description: '第三方 / 自建服务，手动指定请求格式', defaultBaseUrl: '', local: false },
  { value: 'ollama', label: 'Ollama · 本地', description: 'http://localhost:11434 · 数据不出本机', defaultBaseUrl: 'http://localhost:11434', local: true },
]

export const kindMeta = (kind: ProviderKind): ProviderKindMeta => PROVIDER_KINDS.find((k) => k.value === kind) ?? (PROVIDER_KINDS[3] as ProviderKindMeta)

export const isLocalKind = (kind: ProviderKind): boolean => kindMeta(kind).local

/** Secret-store ref for a provider's key (convention shared with the main process). */
export const apiKeyRefFor = (providerId: string): string => `provider:${providerId}:apiKey`

let seq = 0
/** New, empty provider for the 添加提供商 action. `id` is stable and safe as a secret ref segment. */
export function newProvider(kind: ProviderKind, id?: string): ProviderConfig {
  const meta = kindMeta(kind)
  const pid = id ?? `${kind}-${Date.now().toString(36)}${(seq++).toString(36)}`
  return { id: pid, kind, label: meta.label, baseUrl: meta.defaultBaseUrl || undefined, models: [] }
}

export interface ModelDraft {
  kind: ProviderKind
  baseUrl: string
  modelId: string
  /** Key typed in this session; '' = unchanged (keep the stored one). */
  apiKey: string
}

export interface ModelDraftErrors {
  baseUrl?: string
  modelId?: string
  apiKey?: string
}

export function draftFromProvider(p: ProviderConfig): ModelDraft {
  return { kind: p.kind, baseUrl: p.baseUrl ?? '', modelId: p.models[0]?.modelId ?? '', apiKey: '' }
}

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

/** `hasStoredKey` = secret:has for the provider's ref. */
export function validateModelDraft(d: ModelDraft, hasStoredKey: boolean): ModelDraftErrors {
  const errors: ModelDraftErrors = {}
  const url = d.baseUrl.trim()
  if (!url) {
    if (d.kind === 'openai-compatible' || d.kind === 'ollama') errors.baseUrl = '请填写接口 URL'
  } else if (!URL_RE.test(url)) errors.baseUrl = 'URL 需以 http:// 或 https:// 开头'
  if (!d.modelId.trim()) errors.modelId = '请填写模型 ID'
  if (!isLocalKind(d.kind) && !d.apiKey.trim() && !hasStoredKey) errors.apiKey = '请填写 API Key'
  return errors
}

export const isDraftValid = (e: ModelDraftErrors): boolean => Object.keys(e).length === 0

export function draftDirty(p: ProviderConfig, d: ModelDraft): boolean {
  const base = draftFromProvider(p)
  return base.kind !== d.kind || base.baseUrl !== d.baseUrl.trim() || base.modelId !== d.modelId.trim() || d.apiKey.trim().length > 0
}

/** Apply the form draft: kind / baseUrl and the primary model (kept first; other models preserved). */
export function applyDraft(p: ProviderConfig, d: ModelDraft, opts: { supportsTools?: boolean; apiKeyRef?: string } = {}): ProviderConfig {
  const modelId = d.modelId.trim()
  const existing = p.models.find((m) => m.modelId === modelId)
  const primary = existing
    ? { ...existing, supportsTools: opts.supportsTools ?? existing.supportsTools }
    : { modelId, label: modelId, contextWindow: 128_000, supportsTools: opts.supportsTools ?? true, supportsVision: false, enabled: true }
  const rest = p.models.filter((m) => m.modelId !== modelId)
  const url = d.baseUrl.trim() || kindMeta(d.kind).defaultBaseUrl
  return {
    ...p,
    kind: d.kind,
    label: p.label || kindMeta(d.kind).label,
    baseUrl: url || undefined,
    apiKeyRef: opts.apiKeyRef ?? p.apiKeyRef,
    models: [primary, ...rest],
  }
}

export type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; latencyMs?: number; supportsTools: boolean }
  | { status: 'error'; message: string }

const ERROR_CODE_LABEL: Record<NonNullable<ModelTestResult['error']>['code'], string> = {
  auth: '鉴权失败',
  rate_limit: '触发限流',
  context_overflow: '上下文超限',
  network: '网络错误',
  invalid_request: '请求无效',
  unsupported_tools: '不支持工具调用',
  unknown: '连接失败',
}

export function testStateFromResult(r: ModelTestResult): TestState {
  if (r.ok) return { status: 'ok', latencyMs: r.latencyMs, supportsTools: r.supportsTools ?? true }
  const code = r.error?.code ?? 'unknown'
  const status = r.error?.status ? ` ${r.error.status}` : ''
  return { status: 'error', message: `${ERROR_CODE_LABEL[code]}${status}${r.error?.message ? `：${r.error.message}` : ''}` }
}

export interface StatusLine {
  kind: 'success' | 'warning' | 'error' | 'info'
  text: string
}

/** Copy for the 连接状态 row. */
export function testStatusLine(s: TestState, purpose: 'agent' | 'stt' = 'agent'): StatusLine {
  switch (s.status) {
    case 'idle':
      return { kind: 'info', text: '尚未测试' }
    case 'testing':
      return { kind: 'info', text: '测试中…' }
    case 'ok': {
      const latency = s.latencyMs !== undefined ? ` · 延迟 ${Math.round(s.latencyMs)} ms` : ''
      if (purpose === 'agent' && !s.supportsTools) return { kind: 'warning', text: `已连接${latency} · 不支持工具调用，Agent 功能将受限` }
      return { kind: 'success', text: `已连接${latency}${purpose === 'agent' ? ' · 支持工具调用' : ''}` }
    }
    case 'error':
      return { kind: 'error', text: s.message }
  }
}

export interface ModelOption {
  value: string
  label: string
  description: string
  local: boolean
  selection: ModelSelection
}

export const modelValue = (sel: ModelSelection): string => `${sel.providerId}::${sel.modelId}`

export function parseModelValue(v: string | null | undefined): ModelSelection | undefined {
  if (!v) return undefined
  const idx = v.indexOf('::')
  if (idx <= 0) return undefined
  return { providerId: v.slice(0, idx), modelId: v.slice(idx + 2) }
}

/** Every configured model across providers, for 默认模型 and similar pickers. */
export function modelOptions(providers: readonly ProviderConfig[]): ModelOption[] {
  const out: ModelOption[] = []
  for (const p of providers) {
    for (const m of p.models) {
      if (m.enabled === false || m.available === false) continue
      const selection = { providerId: p.id, modelId: m.modelId }
      out.push({ value: modelValue(selection), label: m.label || m.modelId, description: `${p.label}${m.supportsTools ? '' : ' · 不支持工具调用'}`, local: isLocalKind(p.kind), selection })
    }
  }
  return out
}

/** Case-insensitive contains filter, keeping the exact match first. */
export function filterSuggestions(all: readonly string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase()
  const matched = q ? all.filter((m) => m.toLowerCase().includes(q)) : [...all]
  matched.sort((a, b) => Number(b.toLowerCase() === q) - Number(a.toLowerCase() === q))
  return matched.slice(0, limit)
}

/* ------------------------------------------------------------------ vendor / provider list (Figma 164:4211) */

export interface ReasoningEffortMeta {
  value: ReasoningEffort
  label: string
  description: string
}

/** 推理强度 options (Figma 164:3532): 关闭 / 低 / 中 / 高 / 极高. */
export const REASONING_EFFORTS: readonly ReasoningEffortMeta[] = [
  { value: 'off', label: '关闭', description: '不思考，直接作答' },
  { value: 'minimal', label: '最低', description: '最少量推理' },
  { value: 'low', label: '低', description: '快速作答，少量推理' },
  { value: 'medium', label: '中', description: '常规任务的均衡选择' },
  { value: 'high', label: '高', description: '复杂任务，更多推理' },
  { value: 'xhigh', label: '极高', description: '投入更多推理' },
  { value: 'max', label: '最高', description: '最大推理投入' },
]

export const effortLabel = (e: ReasoningEffort | undefined): string | undefined => REASONING_EFFORTS.find((x) => x.value === e)?.label

/** 上下文用量 choices (tokens). */
export const CONTEXT_WINDOWS: readonly number[] = [32_000, 64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000]

/** 128000 → 128k, 1000000 → 1M (settings-page short form). */
export function formatContext(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  return `${Math.round(n / 1000)}k`
}

export type ProviderStatus = 'unconfigured' | 'ready' | 'ok' | 'error'

/**
 * Status dot for the vendor list: `ok` / `error` after a 测试连接, `ready` once a key (or a local endpoint)
 * is stored, `unconfigured` otherwise. Pure — no secret lookup, apiKeyRef is only set after a key was saved.
 */
export function providerStatus(p: ProviderConfig | undefined): ProviderStatus {
  if (!p) return 'unconfigured'
  if (p.lastTest) return p.lastTest.ok ? 'ok' : 'error'
  if (isLocalKind(p.kind) || p.apiKeyRef) return 'ready'
  return 'unconfigured'
}

export const isProviderConnected = (p: ProviderConfig | undefined): boolean => providerStatus(p) !== 'unconfigured'

/** Configured provider for a vendor preset (one per vendor, id = vendor id). */
export const providerForVendor = (providers: readonly ProviderConfig[], vendorId: string): ProviderConfig | undefined => providers.find((p) => p.vendor === vendorId)

/** Providers without a vendor preset (hand-configured endpoints), in config order. */
export const customProviders = (providers: readonly ProviderConfig[]): ProviderConfig[] => providers.filter((p) => !p.vendor)

/** New provider for a vendor preset with an empty model list; `id` = vendor id so the secret ref is stable. */
export function providerFromVendor(v: VendorPreset): ProviderConfig {
  return { id: v.id, vendor: v.id, kind: v.kind, label: v.label, baseUrl: v.baseUrl, models: [] }
}

/** Merge the selected model list into the provider, keeping per-model settings (enabled / 推理强度 / 上下文) of ids that stay. */
export function mergeModels(existing: readonly ModelEntry[], selected: readonly ModelEntry[]): ModelEntry[] {
  return selected.map((m) => {
    const prev = existing.find((e) => e.modelId === m.modelId)
    return prev ? { ...m, ...prev, description: prev.description ?? m.description } : m
  })
}

export function upsertProvider(list: readonly ProviderConfig[], next: ProviderConfig): ProviderConfig[] {
  return list.some((p) => p.id === next.id) ? list.map((p) => (p.id === next.id ? next : p)) : [...list, next]
}

export function patchModel(p: ProviderConfig, modelId: string, patch: Partial<ModelEntry>): ProviderConfig {
  return { ...p, models: p.models.map((m) => (m.modelId === modelId ? { ...m, ...patch } : m)) }
}

export function removeModel(p: ProviderConfig, modelId: string): ProviderConfig {
  return { ...p, ignoredModelIds: [...(p.ignoredModelIds ?? []), modelId], models: p.models.filter((m) => m.modelId !== modelId) }
}

/** A model entry typed by hand or picked from the remote list (no preset note). */
export function modelEntryFromId(modelId: string, contextWindow = 128_000): ModelEntry {
  const id = modelId.trim()
  return { modelId: id, label: id, source: 'manual', contextWindow, supportsTools: true, supportsVision: false, enabled: true }
}

/** First enabled model of the provider, for 测试连接 and the default-model fallback. */
export const primaryModelId = (p: Pick<ProviderConfig, 'models'>): string | undefined => (p.models.find((m) => m.enabled !== false && m.available !== false) ?? p.models[0])?.modelId

/** Pick the default model after a config change: keep it while it still exists and is enabled, else the first enabled one. */
export function resolveDefaultModel(providers: readonly ProviderConfig[], current: ModelSelection | undefined): ModelSelection | undefined {
  if (current) {
    const p = providers.find((x) => x.id === current.providerId)
    const m = p?.models.find((x) => x.modelId === current.modelId)
    if (m && m.enabled !== false && m.available !== false) return current
  }
  for (const p of providers) {
    const id = p.models.find((m) => m.enabled !== false && m.available !== false)?.modelId
    if (id) return { providerId: p.id, modelId: id }
  }
  return undefined
}

/** Refresh metadata without resetting user choices; missing remote models remain visible but unavailable. */
export function syncProviderModels(provider: ProviderConfig, remote: readonly ModelEntry[]): ProviderConfig {
  const ids = new Set(remote.map(m => m.modelId))
  const models = remote.filter(m => !provider.ignoredModelIds?.includes(m.modelId)).map(m => {
    const prev = provider.models.find(p => p.modelId === m.modelId)
    return validModelSettings(provider, prev ? { ...prev, ...m, enabled: prev.enabled,
      contextWindow: prev.contextWindow, maxOutputTokens: prev.maxOutputTokens,
      reasoningEffort: prev.reasoningEffort, thinkingBudget: prev.thinkingBudget,
      temperature: prev.temperature, fast: prev.fast,
    } : { ...m, enabled: provider.models.length ? false : true })
  })
  for (const m of provider.models) if (!ids.has(m.modelId)) models.push({ ...m, available: m.source === 'manual' ? undefined : false })
  return { ...provider, models, modelsSyncedAt: Date.now() }
}
