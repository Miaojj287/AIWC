/**
 * Local model usage accounting (设置 › 用量与记录): which feature asked, which model answered, how many tokens and
 * how long it took. Everything stays on this machine. Request / response content is only kept while the user turned
 * 记录内容 on (`ai.callLog.recordContent`).
 */
import type { ToolProfile } from './tools'

/** Who made a model call. Labels live in the settings.usage.features catalog. */
export const MODEL_USAGE_FEATURES = [
  'agent',
  'task',
  'wechatBot',
  'autoReply',
  'clone',
  'todo',
  /** Idle memory extraction (记忆 › 自动记录). */
  'memory',
  'title',
  'compaction',
  'other',
] as const
export type ModelUsageFeature = (typeof MODEL_USAGE_FEATURES)[number]

export const isModelUsageFeature = (value: unknown): value is ModelUsageFeature =>
  typeof value === 'string' && (MODEL_USAGE_FEATURES as readonly string[]).includes(value)

/** Attached to a SamplingRequest by the caller; adapters ignore it, the main process meters by it. */
export interface ModelCallPurpose {
  feature: ModelUsageFeature
  threadId?: string
}

/** Feature of a kernel turn, from the thread's tool profile. */
export function usageFeatureForProfile(profile: ToolProfile): ModelUsageFeature {
  switch (profile) {
    case 'desktop-chat':
    case 'subagent':
      return 'agent'
    case 'cron':
      return 'task'
    case 'wechat-bot':
    case 'persona':
      return 'wechatBot'
  }
}

export type ModelCallStatus = 'ok' | 'error' | 'aborted'

/** One row of the call log. Always recorded (no content). */
export interface ModelCallRecord {
  id: string
  /** Start time, ms since epoch. */
  at: number
  feature: ModelUsageFeature
  providerId: string
  modelId: string
  /** Inference stayed on this machine. */
  local: boolean
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
  /** Start to last part. */
  latencyMs: number
  /** Start to the first streamed part, when there was one. */
  firstTokenMs?: number
  status: ModelCallStatus
  /** ModelError.code of a failed call (auth / rate_limit / network …). */
  errorCode?: string
  httpStatus?: number
  /** Request / response content was recorded for this call. */
  hasContent: boolean
}

/** A call with its recorded content (API keys and bearer tokens are always redacted). */
export interface ModelCallDetail extends ModelCallRecord {
  request?: string
  response?: string
  /** The redacted error message of a failed call. */
  errorMessage?: string
}

export interface UsageTotals {
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

export interface UsageSummary {
  /** Range covered, ms since epoch (inclusive start, exclusive end). */
  from: number
  to: number
  totals: UsageTotals
  /** Local calendar days (`YYYY-MM-DD`), oldest first, every day of the range present. */
  days: Array<UsageTotals & { day: string }>
  byFeature: Array<UsageTotals & { feature: ModelUsageFeature }>
  byModel: Array<UsageTotals & { providerId: string; modelId: string; local: boolean }>
}

/** Retention of the call log (metadata and content). Daily usage roll-ups are kept until the user clears them. */
export const CALL_LOG_MAX_ROWS = 2000
export const CALL_LOG_MAX_AGE_DAYS = 30
/** Each recorded request / response is cut to this many characters. */
export const CALL_LOG_CONTENT_MAX_CHARS = 64_000
export const USAGE_RANGE_DAYS = [7, 30, 90] as const
export type UsageRangeDays = (typeof USAGE_RANGE_DAYS)[number]
