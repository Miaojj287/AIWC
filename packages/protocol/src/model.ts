/**
 * Model port. The kernel talks to ONE interface; adapters (AI SDK, mock) live behind it.
 * A SamplingRequest is exactly one model call (one Step). The kernel owns the loop.
 */
import type { HistoryItem } from './history'
import type { ToolSpecForModel } from './tools'

export type ProviderKind = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'ollama'

export interface ModelRef {
  providerId: string
  modelId: string
  label: string
  contextWindow: number
  maxOutputTokens?: number
  supportsTools: boolean
  supportsVision: boolean
  /** true when inference never leaves this machine (Ollama / local). */
  local: boolean
}

export interface ModelProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  baseUrl?: string
  /** Reference into the secret store, never the key itself. */
  apiKeyRef?: string
  models: Array<Pick<ModelRef, 'modelId' | 'label' | 'contextWindow' | 'supportsTools' | 'supportsVision'> & { maxOutputTokens?: number }>
}

export interface SamplingRequest {
  /** Three-tier system prompt already assembled (stable → context → volatile). */
  system: string
  history: HistoryItem[]
  tools: ToolSpecForModel[]
  toolChoice: 'auto' | 'none' | 'required'
  maxOutputTokens?: number
  temperature?: number
  signal: AbortSignal
  /** Stable key so adapters can enable provider prompt caching. */
  cacheKey?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | 'aborted' | 'other'

export type SamplingPart =
  | { type: 'text.delta'; delta: string }
  | { type: 'reasoning.delta'; delta: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown; rawInput?: string }
  | { type: 'finish'; reason: FinishReason; usage: TokenUsage }
  | { type: 'error'; error: ModelError }

export interface ModelError {
  code: 'auth' | 'rate_limit' | 'context_overflow' | 'network' | 'invalid_request' | 'unsupported_tools' | 'unknown'
  message: string
  status?: number
  retryable: boolean
}

export interface ModelClient {
  readonly ref: ModelRef
  sample(req: SamplingRequest): AsyncIterable<SamplingPart>
  /** Optional precise counter; the kernel falls back to estimateTokens(). */
  countTokens?(text: string): Promise<number>
}

export interface EmbeddingClient {
  readonly modelId: string
  readonly dimensions: number
  embed(values: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface ModelTestResult {
  ok: boolean
  latencyMs?: number
  supportsTools?: boolean
  error?: ModelError
}
