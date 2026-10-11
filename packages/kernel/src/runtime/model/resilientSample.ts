/**
 * Stream watchdog + bounded retries around one sampling request (the step's single model call).
 *
 * A request is sent again when it fails in a way a retry can fix — judged by the structured ModelError code and HTTP
 * status, never by message text: a rate limit (429, waiting at least what Retry-After asks), a network failure or a
 * 5xx, or a stream that produced nothing for too long (no first part within `firstChunkTimeoutMs`, or a gap longer
 * than `idleTimeoutMs` once parts flow). Each retry is announced with a `restart` part so the step can drop what the
 * failed attempt streamed and the UI can say 「重新连接中 n/m」; when the retries run out the last error is yielded as
 * an ordinary error part. The caller's AbortSignal (interrupt, turn timeout) always wins: it ends the stream and any
 * backoff wait at once and is never retried.
 */
import type { ModelClient, ModelError, SamplingPart, SamplingRequest, StreamRetryReason } from '@aiwc/protocol'

export interface StreamResilience {
  /**
   * No part at all for this long after the request was sent → stalled (reasoning models can be slow to start).
   * 0 disables it: a local model may spend minutes on prefill before its first token.
   */
  firstChunkTimeoutMs: number
  /** No part for this long once the stream has started → stalled. */
  idleTimeoutMs: number
  /** Retries after the first attempt — the m in 「重新连接中 n/m」. */
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  /** A server asking for a longer wait than this is not retried inside the turn. */
  maxRetryAfterMs: number
}

export const DEFAULT_STREAM_RESILIENCE: Readonly<StreamResilience> = Object.freeze({
  firstChunkTimeoutMs: 180_000,
  idleTimeoutMs: 90_000,
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxRetryAfterMs: 120_000,
})

/**
 * Local models (Ollama, LM Studio…) run prefill on the user's own hardware: a long context can take minutes before
 * the first token, so there is no first-chunk deadline and the gap allowed between parts is generous. The turn timeout
 * and Stop still bound the request.
 */
const LOCAL_STREAM_RESILIENCE: Readonly<StreamResilience> = Object.freeze({
  ...DEFAULT_STREAM_RESILIENCE,
  firstChunkTimeoutMs: 0,
  idleTimeoutMs: 300_000,
})

/** A retry is about to happen: the step discards the failed attempt's partial output. */
export interface RestartPart {
  type: 'restart'
  attempt: number
  max: number
  reason: StreamRetryReason
  delayMs: number
}

export type ResilientPart = SamplingPart | RestartPart

export interface ResilientSampleOptions {
  resilience?: Partial<StreamResilience>
  /** Injectable for tests; resolves after `ms` or rejects/settles early when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** 0..1, for backoff jitter. */
  random?: () => number
}

/** The retry class of a failed request, or undefined when retrying cannot help (auth, bad request, overflow…). */
export function retryReasonFor(error: ModelError): StreamRetryReason | undefined {
  switch (error.code) {
    case 'rate_limit':
      return 'rate_limit'
    case 'network':
      return error.status !== undefined && error.status >= 500 ? 'server' : 'network'
    case 'stream_stalled':
      return 'stalled'
    case 'unknown':
      // the provider SDK's own classification (408 / 409 / overloaded) — structured, not a text match
      return error.retryable ? 'network' : undefined
    case 'auth':
    case 'context_overflow':
    case 'invalid_request':
    case 'unsupported_tools':
      return undefined
  }
}

/** Exponential backoff with ±10% jitter, never shorter than what the server asked for. */
export function retryDelayMs(
  attempt: number,
  resilience: Pick<StreamResilience, 'baseDelayMs' | 'maxDelayMs'>,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(resilience.maxDelayMs, resilience.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  const jittered = Math.round(exp * (0.9 + 0.2 * random()))
  return Math.max(jittered, retryAfterMs ?? 0)
}

export function stalledError(seconds: number, attempts: number): ModelError {
  return {
    code: 'stream_stalled',
    message: `模型 ${seconds} 秒没有输出，已重新连接 ${attempts} 次仍未恢复`,
    retryable: true,
  }
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

type AttemptEnd = { kind: 'done' } | { kind: 'retry'; reason: StreamRetryReason; error: ModelError }

export async function* sampleResilient(
  model: ModelClient,
  req: SamplingRequest,
  opts: ResilientSampleOptions = {},
): AsyncGenerator<ResilientPart> {
  const base = model.ref.local ? LOCAL_STREAM_RESILIENCE : DEFAULT_STREAM_RESILIENCE
  const r: StreamResilience = { ...base, ...opts.resilience }
  const sleep = opts.sleep ?? defaultSleep
  const parent = req.signal

  for (let attempt = 0; ; attempt++) {
    // An already-aborted signal never fires 'abort' again, so the per-attempt listener would miss it.
    if (parent.aborted) {
      yield abortedFinish()
      return
    }
    const end: AttemptEnd = yield* runAttempt(model, req, r, attempt)
    if (end.kind === 'done' || parent.aborted) return
    const retryAfter = end.error.retryAfterMs
    if (attempt >= r.maxRetries || (retryAfter !== undefined && retryAfter > r.maxRetryAfterMs)) {
      yield { type: 'error', error: end.error }
      return
    }
    const delayMs = retryDelayMs(attempt + 1, r, retryAfter, opts.random)
    yield { type: 'restart', attempt: attempt + 1, max: r.maxRetries, reason: end.reason, delayMs }
    await sleep(delayMs, parent)
  }
}

const abortedFinish = (): SamplingPart => ({
  type: 'finish',
  reason: 'aborted',
  usage: { inputTokens: 0, outputTokens: 0 },
})

/** One request with its own watchdog. Yields the parts it passes through; returns whether to retry. */
async function* runAttempt(
  model: ModelClient,
  req: SamplingRequest,
  r: StreamResilience,
  attempt: number,
): AsyncGenerator<ResilientPart, AttemptEnd> {
  const parent = req.signal
  const child = new AbortController()
  const onParentAbort = (): void => child.abort(parent.reason)
  parent.addEventListener('abort', onParentAbort, { once: true })
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let armedMs = r.firstChunkTimeoutMs
  const arm = (ms: number): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    armedMs = ms
    if (!(ms > 0)) return
    timer = setTimeout(() => {
      stalled = true
      child.abort(new Error('stream stalled'))
    }, ms)
    ;(timer as { unref?: () => void }).unref?.()
  }
  const stalledEnd = (): AttemptEnd => ({
    kind: 'retry',
    reason: 'stalled',
    error: stalledError(Math.round(armedMs / 1000), attempt),
  })

  arm(r.firstChunkTimeoutMs)
  try {
    for await (const part of model.sample({ ...req, signal: child.signal })) {
      if (stalled && !parent.aborted) return stalledEnd()
      arm(r.idleTimeoutMs)
      if (part.type === 'error' && !parent.aborted) {
        const reason = retryReasonFor(part.error)
        if (reason) return { kind: 'retry', reason, error: part.error }
      }
      // An adapter that swallowed our watchdog abort reports it as an ordinary abort; that is a stall, not a stop.
      if (part.type === 'finish' && part.reason === 'aborted' && stalled && !parent.aborted) return stalledEnd()
      yield part
      if (part.type === 'error') return { kind: 'done' }
    }
  } catch (err) {
    if (!(stalled && !parent.aborted)) throw err
  } finally {
    if (timer) clearTimeout(timer)
    parent.removeEventListener('abort', onParentAbort)
  }
  return stalled && !parent.aborted ? stalledEnd() : { kind: 'done' }
}
