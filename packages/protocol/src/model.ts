/**
 * Model port. The kernel talks to ONE interface; adapters (AI SDK, mock) live behind it.
 * A SamplingRequest is exactly one model call (one Step). The kernel owns the loop.
 */
import type { HistoryItem } from './history'
import type { ToolSpecForModel } from './tools'
import type { ModelCallPurpose } from './modelUsage'
import type { ReasoningEffort } from './config'

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
  /** Who asked (local usage accounting, 设置 › 用量与记录). Adapters ignore it. */
  purpose?: ModelCallPurpose
  /**
   * Reasoning depth for this call, overriding the model entry's own setting when the model supports it. `lowest` =
   * the least the model allows (no thinking where it can be turned off): internal calls such as titles and compaction.
   */
  reasoningEffort?: ReasoningEffort | 'lowest'
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
  /** A tool call's arguments as the model writes them (raw JSON text, continued); `tool_call` follows with the whole. */
  | { type: 'tool_input.delta'; callId: string; name: string; delta: string }
  | { type: 'finish'; reason: FinishReason; usage: TokenUsage }
  | { type: 'error'; error: ModelError }

export interface ModelError {
  code:
    | 'auth'
    | 'rate_limit'
    | 'context_overflow'
    | 'network'
    | 'invalid_request'
    | 'unsupported_tools'
    /** No output for too long, and the retries ran out (kernel stream watchdog). */
    | 'stream_stalled'
    | 'unknown'
  message: string
  status?: number
  retryable: boolean
  /** Server-requested wait before retrying (HTTP Retry-After / retry-after-ms), when it sent one. */
  retryAfterMs?: number
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
