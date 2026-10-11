/**
 * HTTP client for TypeSafe's Jev (POST /v1/systemone, GET /v1/models — https://docs.typesafe.ai/api).
 *
 * One request = one state + a map of typed questions; the answer carries probabilities, never text.
 * Every call has a timeout, honours an AbortSignal, validates the JSON with the protocol schema and
 * maps HTTP failures to a `JevClientError` with a stable code — the user-facing sentence is built
 * from that code in the UI language. Keys stay in the secret store; nothing here logs the state.
 */
import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JevResponseSchema,
  type AppConfig,
  type JevErrorCode,
  type JevQuestion,
  type JevRequest,
  type JevResponse,
  type JevTestResult,
} from '@aiwc/protocol'
import { z } from 'zod'
import type { SecretStore } from '../config/secretStore'
import { t } from '../i18n'

export const JEV_REQUEST_TIMEOUT_MS = 20_000
/** One retry on 429 / 529, after the server's retry-after when it is short, else this. */
const RETRY_DELAY_MS = 1000
const RETRY_AFTER_MAX_MS = 5000

export class JevClientError extends Error {
  readonly code: JevErrorCode
  readonly status?: number
  constructor(code: JevErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'JevClientError'
    this.code = code
    this.status = status
  }
}

export interface JevClientDeps {
  config: () => AppConfig
  secrets: Pick<SecretStore, 'reveal'>
  fetch?: typeof fetch
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
  now?: () => number
  /** Test hook: how to wait before the single retry. */
  sleep?: (ms: number) => Promise<void>
}

export interface JevAskOptions {
  signal?: AbortSignal
  /** Override the stored key / endpoint (the settings page tests a typed key before saving it). */
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface JevClient {
  /** True when a key is stored — the rail's editor asks this before offering the dry run. */
  configured(): boolean
  ask(state: unknown, questions: Record<string, JevQuestion>, opts?: JevAskOptions): Promise<JevResponse>
  test(opts?: Pick<JevAskOptions, 'apiKey' | 'baseUrl' | 'model' | 'signal'>): Promise<JevTestResult>
}

const ErrorBodySchema = z
  .object({
    error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
    message: z.string().optional(),
    detail: z.unknown().optional(),
  })
  .partial()

/** A short, safe detail from an error body: the API's own message, never the echoed request. */
function detailOf(body: string): string {
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(body))
    if (!parsed.success) return ''
    const err = parsed.data.error
    const text =
      typeof err === 'string'
        ? err
        : (err?.message ??
          parsed.data.message ??
          (typeof parsed.data.detail === 'string' ? parsed.data.detail : undefined) ??
          '')
    return text.slice(0, 200)
  } catch {
    return body.slice(0, 120)
  }
}

export function userMessageFor(code: JevErrorCode, detail: { status?: number; detail?: string } = {}): string {
  switch (code) {
    case 'no_key':
      return t('main.jev.noKey')
    case 'unauthorized':
      return t('main.jev.unauthorized')
    case 'rate_limited':
      return t('main.jev.rateLimited')
    case 'invalid_request':
      return t('main.jev.invalidRequest', { detail: detail.detail || String(detail.status ?? '') })
    case 'overloaded':
      return t('main.jev.overloaded')
    case 'server':
      return t('main.jev.server', { status: detail.status ?? 0 })
    case 'network':
      return t('main.jev.network', { detail: detail.detail ?? '' })
    case 'timeout':
      return t('main.jev.timeout')
    case 'invalid_response':
      return t('main.jev.invalidResponse')
  }
}

function errorForStatus(status: number, body: string): JevClientError {
  const detail = detailOf(body)
  if (status === 401 || status === 403)
    return new JevClientError('unauthorized', userMessageFor('unauthorized'), status)
  if (status === 429) return new JevClientError('rate_limited', userMessageFor('rate_limited'), status)
  if (status === 529 || status === 503) return new JevClientError('overloaded', userMessageFor('overloaded'), status)
  if (status >= 400 && status < 500)
    return new JevClientError('invalid_request', userMessageFor('invalid_request', { status, detail }), status)
  return new JevClientError('server', userMessageFor('server', { status }), status)
}

const retryable = (status: number): boolean => status === 429 || status === 529 || status === 503

function retryDelayMs(headers: Headers): number {
  const raw = headers.get('retry-after')
  const seconds = raw ? Number(raw) : NaN
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS)
  return RETRY_DELAY_MS
}

/** Origin + optional path prefix, no trailing slash, so `/v1/...` appends cleanly (also through a proxy). */
export function normaliseBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  return trimmed || JEV_DEFAULT_BASE_URL
}

export function createJevClient(deps: JevClientDeps): JevClient {
  const doFetch = deps.fetch ?? fetch
  const log = deps.logger ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const settings = (opts: JevAskOptions = {}) => {
    const cfg = deps.config().ai.jev
    const stored = cfg.apiKeyRef ? (deps.secrets.reveal(cfg.apiKeyRef) ?? undefined) : undefined
    return {
      apiKey: opts.apiKey?.trim() || stored,
      baseUrl: normaliseBaseUrl(opts.baseUrl ?? cfg.baseUrl),
      model: opts.model?.trim() || cfg.model || JEV_DEFAULT_MODEL,
    }
  }

  async function request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string; apiKey: string; baseUrl: string },
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(abort, JEV_REQUEST_TIMEOUT_MS)
    try {
      for (let attempt = 0; ; attempt++) {
        let response: Response
        try {
          response = await doFetch(`${init.baseUrl}${path}`, {
            method: init.method,
            headers: {
              Authorization: `Bearer ${init.apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: init.body,
            signal: controller.signal,
          })
        } catch (e) {
          if (controller.signal.aborted)
            throw new JevClientError(signal?.aborted ? 'network' : 'timeout', userMessageFor('timeout'))
          const detail = e instanceof Error ? e.message : String(e)
          throw new JevClientError('network', userMessageFor('network', { detail }))
        }
        if (response.ok) {
          try {
            return await response.json()
          } catch {
            throw new JevClientError('invalid_response', userMessageFor('invalid_response'), response.status)
          }
        }
        const body = await response.text().catch(() => '')
        if (attempt === 0 && retryable(response.status)) {
          const delay = retryDelayMs(response.headers)
          log('debug', 'jev request throttled, retrying once', { status: response.status, delay })
          await sleep(delay)
          if (controller.signal.aborted) throw new JevClientError('timeout', userMessageFor('timeout'))
          continue
        }
        throw errorForStatus(response.status, body)
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  return {
    configured() {
      const cfg = deps.config().ai.jev
      return Boolean(cfg.apiKeyRef && deps.secrets.reveal(cfg.apiKeyRef))
    },
    async ask(state, questions, opts = {}) {
      const s = settings(opts)
      if (!s.apiKey) throw new JevClientError('no_key', userMessageFor('no_key'))
      const payload: JevRequest = { model: s.model, state, questions }
      const started = now()
      const raw = await request(
        '/v1/systemone',
        { method: 'POST', body: JSON.stringify(payload), apiKey: s.apiKey, baseUrl: s.baseUrl },
        opts.signal,
      )
      const parsed = JevResponseSchema.safeParse(raw)
      if (!parsed.success) {
        log('warn', 'jev response failed validation', { issues: parsed.error.issues.slice(0, 3) })
        throw new JevClientError('invalid_response', userMessageFor('invalid_response'))
      }
      log('debug', 'jev answered', {
        model: parsed.data.model,
        ms: now() - started,
        inputTokens: parsed.data.usage?.input_tokens,
        questions: Object.keys(questions).length,
      })
      return parsed.data
    },
    async test(opts = {}) {
      const s = settings(opts)
      if (!s.apiKey) return { ok: false, code: 'no_key', error: userMessageFor('no_key') }
      const started = now()
      try {
        const raw = await request('/v1/models', { method: 'GET', apiKey: s.apiKey, baseUrl: s.baseUrl }, opts.signal)
        const list = z.object({ models: z.array(z.object({ name: z.string() })).default([]) }).safeParse(raw)
        return {
          ok: true,
          latencyMs: now() - started,
          models: list.success ? list.data.models.map((m) => m.name) : [],
        }
      } catch (e) {
        if (e instanceof JevClientError)
          return { ok: false, code: e.code, error: e.message, latencyMs: now() - started }
        return { ok: false, code: 'network', error: userMessageFor('network', { detail: String(e) }) }
      }
    },
  }
}
