/**
 * Thin helpers over the stream-based ModelClient port:
 *  - sampleText(): one system + one user message, no tools, collects `text.delta` parts; every call has a
 *    deadline (MODEL_CALL_TIMEOUT_MS unless the caller passes one) combined with the caller's signal
 *  - extractJson(): first balanced {...} block from free-form model output (fences, prefixes tolerated)
 *  - generateValidated(): sampleText + extractJson + zod parse, one retry with a stricter nudge
 */
import type { ModelClient, ModelError, SamplingPart, SamplingRequest, UserMessageItem } from '@aiwc/protocol'
import { newItemId, newTurnId } from '@aiwc/protocol'
import type { z } from 'zod'

export class ModelSampleError extends Error {
  readonly error: ModelError
  constructor(error: ModelError) {
    super(error.message)
    this.name = 'ModelSampleError'
    this.error = error
  }
}

/**
 * Deadline for one model call (diary summary / synthesis, clone extraction / merge, reflection). Generous
 * enough for a slow local model writing ~2k tokens; a stream still open after it is a failure, not a hang.
 */
export const MODEL_CALL_TIMEOUT_MS = 5 * 60_000

export interface SampleTextOptions {
  signal?: AbortSignal
  /** Deadline for this call; defaults to MODEL_CALL_TIMEOUT_MS. Whichever of it and `signal` fires first stops the call. */
  timeoutMs?: number
  maxOutputTokens?: number
  temperature?: number
  cacheKey?: string
}

const abortedError = () => new ModelSampleError({ code: 'unknown', message: 'aborted', retryable: false })

const timeoutError = (ms: number) =>
  new ModelSampleError({
    code: 'network',
    message: `model call timed out after ${Math.round(ms / 1000)}s`,
    retryable: true,
  })

/** Stop switch for one call: trips on the caller's signal or at the deadline, whichever comes first. */
function callDeadline(callerSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let reason: ModelSampleError | undefined
  const stop = (error: ModelSampleError) => {
    if (controller.signal.aborted) return
    reason = error
    controller.abort()
  }
  /** Rejects with the reason once tripped; raced against every read of the stream. */
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(reason ?? abortedError()), { once: true })
  })
  // The race handles the rejection; this branch only keeps a trip between two reads from being reported as unhandled.
  void stopped.catch(() => undefined)
  const onCallerAbort = () => stop(abortedError())
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => stop(timeoutError(timeoutMs)), timeoutMs)
  return {
    signal: controller.signal,
    stopped,
    reason: () => reason,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
}

/**
 * Collect the text of one model call. Throws ModelSampleError on an `error` part, on abort ('aborted') and
 * on the deadline ('timed out'). Each read is raced against the stop switch, so a provider stream that
 * ignores `req.signal` still cannot keep the call alive.
 */
export async function sampleText(
  model: ModelClient,
  system: string,
  user: string,
  opts: SampleTextOptions = {},
): Promise<string> {
  if (opts.signal?.aborted) throw abortedError()
  const deadline = callDeadline(opts.signal, opts.timeoutMs ?? MODEL_CALL_TIMEOUT_MS)
  const userItem: UserMessageItem = {
    type: 'user_message',
    id: newItemId(),
    turnId: newTurnId(),
    createdAt: Date.now(),
    content: [{ type: 'text', text: user }],
    mentions: [],
  }
  const req: SamplingRequest = {
    system,
    history: [userItem],
    tools: [],
    toolChoice: 'none',
    signal: deadline.signal,
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.cacheKey !== undefined ? { cacheKey: opts.cacheKey } : {}),
  }
  let iterator: AsyncIterator<SamplingPart> | undefined
  let finished = false
  try {
    iterator = model.sample(req)[Symbol.asyncIterator]()
    let text = ''
    for (;;) {
      const step = await Promise.race([iterator.next(), deadline.stopped])
      if (step.done) {
        finished = true
        return text
      }
      const part = step.value
      if (part.type === 'text.delta') text += part.delta
      else if (part.type === 'error') throw new ModelSampleError(part.error)
      else if (part.type === 'finish' && part.reason === 'aborted') throw deadline.reason() ?? abortedError()
    }
  } finally {
    deadline.dispose()
    // Let the provider run its cleanup. Not awaited: a stalled stream may never settle, and its outcome is moot.
    if (!finished) void iterator?.return?.().catch(() => undefined)
  }
}

/**
 * Pull the first balanced JSON object out of arbitrary text. Handles ```json fences, leading prose
 * and trailing commentary; string literals containing braces are respected.
 */
export function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) t = fence[1].trim()
  const start = t.indexOf('{')
  if (start < 0) throw new Error('no JSON object found')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(t.slice(start, i + 1))
    }
  }
  // unbalanced: fall back to first '{' … last '}'
  const end = t.lastIndexOf('}')
  if (end > start) return JSON.parse(t.slice(start, end + 1))
  throw new Error('unbalanced JSON object')
}

const RETRY_NUDGE =
  '\n\n注意：上一次输出无法解析为 JSON。请严格只输出一个合法的 JSON 对象，不要任何解释、前后缀或代码围栏。'

/** Text generation + lenient JSON extraction + zod validation; one retry, then throws with a raw excerpt. */
export async function generateValidated<T>(
  model: ModelClient,
  input: { system: string; user: string; label: string } & SampleTextOptions,
  schema: z.ZodType<T>,
): Promise<T> {
  let lastRaw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    lastRaw = await sampleText(model, input.system, attempt === 0 ? input.user : input.user + RETRY_NUDGE, input)
    try {
      return schema.parse(extractJson(lastRaw))
    } catch {
      if (input.signal?.aborted) break
    }
  }
  throw new Error(`${input.label}解析失败，模型输出不是合法 JSON：${lastRaw.slice(0, 200)}`)
}

/** Run `items` through `worker` with at most `limit` in flight; results keep input order, failures become undefined. */
export async function mapConcurrent<I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
  onDone?: (done: number, total: number) => void,
): Promise<Array<O | undefined>> {
  const results: Array<O | undefined> = new Array(items.length).fill(undefined)
  let next = 0
  let done = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      const item = items[i] as I
      try {
        results[i] = await worker(item, i)
      } catch {
        results[i] = undefined
      }
      done++
      onDone?.(done, items.length)
    }
  })
  await Promise.all(lanes)
  return results
}
