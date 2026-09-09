/**
 * Settings-page helpers: connectivity test and remote model listing. No kernel state involved.
 */
import { modelCapabilities, type ModelEntry, type ModelTestResult, type ProviderConfig } from '@aiwc/protocol'
import { generateText, jsonSchema, tool } from 'ai'
import { toModelError } from './errors'
import { createLanguageModel, providerBaseUrl } from './providers'

export interface TestModelInput {
  provider: ProviderConfig
  modelId: string
  apiKey?: string
  signal?: AbortSignal
}

const PROBE_TOOL = tool({
  description: 'Connectivity probe. Call with ok=true.',
  inputSchema: jsonSchema<{ ok: boolean }>({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }),
})

export async function testModel(input: TestModelInput): Promise<ModelTestResult> {
  const started = Date.now()
  const signal = input.signal ?? AbortSignal.timeout(30_000)
  const providerOptions = input.provider.kind === 'openai' ? { openai: { store: false } } : undefined
  let model
  try {
    model = createLanguageModel(input.provider, input.modelId, input.apiKey)
  } catch (err) {
    return { ok: false, error: toModelError(err) }
  }
  try {
    await generateText({ model, prompt: '1', maxOutputTokens: 64, providerOptions, maxRetries: 0, abortSignal: signal })
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, error: toModelError(err) }
  }
  const latencyMs = Date.now() - started
  let supportsTools = true
  try {
    await generateText({
      model,
      prompt: 'Call the probe tool with ok=true.',
      tools: { probe: PROBE_TOOL },
      toolChoice: 'required',
      maxOutputTokens: 64,
      providerOptions,
      maxRetries: 0,
      abortSignal: signal,
    })
  } catch (err) {
    const e = toModelError(err)
    if (e.code === 'unsupported_tools' || e.code === 'invalid_request') supportsTools = false
    else if (e.code === 'auth' || e.code === 'network') return { ok: false, latencyMs, error: e }
  }
  return { ok: true, latencyMs, supportsTools }
}

export interface ListRemoteModelsInput {
  provider: ProviderConfig
  apiKey?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

interface ListEndpoint {
  url: string
  headers: Record<string, string>
}

export function modelsEndpoint(provider: ProviderConfig, apiKey?: string): ListEndpoint {
  const kind = provider.kind
  const base = providerBaseUrl(provider)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (kind === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    return { url: `${(base ?? 'https://api.anthropic.com').replace(/\/v1$/, '')}/v1/models?limit=1000`, headers }
  }
  if (kind === 'google') {
    if (apiKey) headers['x-goog-api-key'] = apiKey
    return { url: `${base ?? 'https://generativelanguage.googleapis.com/v1beta'}/models?pageSize=200`, headers }
  }
  if (kind === 'ollama') return { url: `${(base ?? 'http://localhost:11434').replace(/\/v1$/, '')}/api/tags`, headers }
  const resolved = base ?? (kind === 'openai' ? 'https://api.openai.com/v1' : undefined)
  if (!resolved) throw new Error(`provider ${provider.id}: baseUrl is required to list models`)
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return { url: `${resolved}/models`, headers }
}

type Row = Record<string, unknown>
function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function positive(value: unknown): number | undefined { return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined }

async function listRows(input: ListRemoteModelsInput): Promise<Row[]> {
  const endpoint = modelsEndpoint(input.provider, input.apiKey)
  const doFetch = input.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(30_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const rows: Row[] = []
  const visited = new Set<string>()
  let url: string | undefined = endpoint.url
  while (url) {
    if (visited.has(url) || visited.size >= 100) throw new Error('模型列表分页异常，请稍后重试')
    visited.add(url)
    const res = await doFetch(url, { headers: endpoint.headers, signal })
    if (!res.ok) throw Object.assign(new Error(`拉取模型列表失败（HTTP ${res.status}）`), { statusCode: res.status })
    const body = record(await res.json())
    const data = body.data ?? body.models
    if (!Array.isArray(data)) throw new Error('接口未返回有效的模型列表')
    rows.push(...data.map(record))
    const next = new URL(endpoint.url)
    if (typeof body.nextPageToken === 'string' && body.nextPageToken) {
      next.searchParams.set('pageToken', body.nextPageToken)
      url = next.toString()
    } else if (body.has_more === true) {
      const last = body.last_id ?? record(data.at(-1)).id
      if (typeof last !== 'string' || !last) throw new Error('模型列表缺少分页游标')
      next.searchParams.set(input.provider.kind === 'anthropic' ? 'after_id' : 'after', last)
      url = next.toString()
    } else url = undefined
  }
  return rows
}

function rowId(row: Row): string | undefined {
  const id = row.id ?? row.name ?? row.model
  return typeof id === 'string' && id.trim() ? id.replace(/^models\//, '') : undefined
}

/** Unfiltered IDs are retained for speech model pickers. No static fallback on errors. */
export async function listRemoteModels(input: ListRemoteModelsInput): Promise<string[]> {
  return [...new Set((await listRows(input)).map(rowId).filter((id): id is string => Boolean(id)))]
}

/** Live conversational catalogue, enriched only by explicit API metadata or known profiles. */
export async function discoverModels(input: ListRemoteModelsInput): Promise<ModelEntry[]> {
  const rows = await listRows(input)
  const result = new Map<string, ModelEntry>()
  const created = (r: Row) => typeof r.created === 'number' ? r.created * 1000 : typeof r.created_at === 'string' ? Date.parse(r.created_at) || 0 : 0
  rows.sort((a, b) => created(b) - created(a))
  for (const row of rows) {
    const modelId = rowId(row)
    if (!modelId) continue
    if (Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes('generateContent')) continue
    if (/(?:embedding|rerank|moderation|whisper|tts|transcrib|realtime|dall-e|sora|imagen|veo|image|audio|deep-research)/i.test(modelId)) continue
    if (input.provider.kind === 'openai' && !/^(?:gpt-|chatgpt-|o[134](?:-|$)|codex-|ft:)/.test(modelId)) continue
    const c = modelCapabilities(input.provider, { modelId })
    const api = input.provider.kind === 'anthropic' ? record(row.capabilities) : {}
    const effort = record(api.effort)
    const thinking = record(api.thinking)
    if (typeof effort.supported === 'boolean') {
      c.reasoning = effort.supported ? (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter(level => record(effort[level]).supported === true) : []
      c.thinking = c.reasoning.length ? (record(record(thinking.types).adaptive).supported === true ? 'adaptive' : 'effort') : 'none'
      if (c.thinking === 'adaptive') c.temperature = false
      c.source = 'api'
    }
    if (record(record(thinking.types).enabled).supported === true && !c.reasoning.length) {
      c.thinking = 'budget'; c.thinkingBudgetMin = 1024; c.thinkingBudgetMax = 32_000; c.source = 'api'
    }
    c.contextLimit = positive(row.inputTokenLimit ?? row.max_input_tokens ?? row.context_length) ?? c.contextLimit
    c.outputLimit = positive(row.outputTokenLimit ?? row.max_tokens ?? record(row.top_provider).max_completion_tokens) ?? c.outputLimit
    if (positive(row.inputTokenLimit ?? row.max_input_tokens ?? row.context_length)) c.source = 'api'
    const label = row.display_name ?? row.displayName
    result.set(modelId, {
      modelId, label: typeof label === 'string' && label ? label : modelId,
      contextWindow: Math.min(c.contextLimit ?? 128_000, 128_000),
      supportsTools: true, supportsVision: record(api.image_input).supported === true,
      enabled: true, source: 'remote', available: true, capabilities: c,
    })
  }
  return [...result.values()]
}
