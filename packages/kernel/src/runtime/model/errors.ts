/**
 * Error normalisation: anything thrown by a provider becomes a ModelError with a stable code, and every
 * code maps to the actionable buttons the UI shows (CLAUDE.md §5: never just report, always offer a fix).
 */
import type { ErrorAction, ModelError } from '@aiwc/protocol'
import { APICallError } from 'ai'

const CONTEXT_RE = /context[_ ]?(length|window)|maximum context|too many tokens|prompt is too long|input is too long|exceeds the (model'?s )?(context|maximum)|max_tokens.*context|token limit|reduce the length/i
const TOOLS_RE = /tool(s|_choice| use| calling)?[^.]{0,40}(not |un)support|does not support tools|function calling is not/i
const NETWORK_RE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network|timed out|timeout/i

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; code?: unknown }
  return e.name === 'AbortError' || e.code === 'ABORT_ERR' || e.code === 20
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function toModelError(err: unknown): ModelError {
  if (isModelError(err)) return err
  const message = messageOf(err)
  let status: number | undefined
  let body = ''
  let retryable = false
  if (APICallError.isInstance(err)) {
    status = err.statusCode
    body = err.responseBody ?? ''
    retryable = err.isRetryable
  } else if (err && typeof err === 'object' && typeof (err as { statusCode?: unknown }).statusCode === 'number') {
    status = (err as { statusCode: number }).statusCode
  }
  const haystack = `${message}\n${body}`

  if (status === 401 || status === 403) return { code: 'auth', message, status, retryable: false }
  if (status === 429) return { code: 'rate_limit', message, status, retryable: true }
  if (CONTEXT_RE.test(haystack)) return { code: 'context_overflow', message, status, retryable: false }
  if (TOOLS_RE.test(haystack)) return { code: 'unsupported_tools', message, status, retryable: false }
  if (status === 400 || status === 404 || status === 422) return { code: 'invalid_request', message, status, retryable: false }
  if (status !== undefined && status >= 500) return { code: 'network', message, status, retryable: true }
  if (status === undefined && NETWORK_RE.test(haystack)) return { code: 'network', message, retryable: true }
  return { code: 'unknown', message, status, retryable }
}

export function isModelError(v: unknown): v is ModelError {
  if (!v || typeof v !== 'object') return false
  const e = v as Partial<ModelError>
  return typeof e.code === 'string' && typeof e.message === 'string' && typeof e.retryable === 'boolean'
}

/** Buttons the UI renders next to an error event. */
export function errorActions(error: { code: string }): ErrorAction[] {
  switch (error.code) {
    case 'auth':
      return [
        { label: '去改 Key', action: 'open_settings_ai' },
        { label: '重试', action: 'retry' },
      ]
    case 'unsupported_tools':
    case 'invalid_request':
      return [
        { label: '更换模型', action: 'open_settings_ai' },
        { label: '重试', action: 'retry' },
      ]
    case 'context_overflow':
      return [
        { label: '压缩上下文', action: 'compact' },
        { label: '重试', action: 'retry' },
      ]
    default:
      return [
        { label: '重试', action: 'retry' },
        { label: '关闭', action: 'dismiss' },
      ]
  }
}
