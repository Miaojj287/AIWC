/**
 * Thin helpers over the stream-based ModelClient port:
 *  - sampleText(): one system + one user message, no tools, collects `text.delta` parts
 *  - extractJson(): first balanced {...} block from free-form model output (fences, prefixes tolerated)
 *  - generateValidated(): sampleText + extractJson + zod parse, one retry with a stricter nudge
 */
import type { ModelClient, ModelError, SamplingRequest, UserMessageItem } from '@aiwc/protocol'
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

export interface SampleTextOptions {
  signal?: AbortSignal
  maxOutputTokens?: number
  temperature?: number
  cacheKey?: string
}

/** Collect the text of one model call. Throws ModelSampleError on an `error` part; aborts surface as errors too. */
export async function sampleText(model: ModelClient, system: string, user: string, opts: SampleTextOptions = {}): Promise<string> {
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
    signal: opts.signal ?? new AbortController().signal,
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.cacheKey !== undefined ? { cacheKey: opts.cacheKey } : {}),
  }
  let text = ''
  for await (const part of model.sample(req)) {
    if (part.type === 'text.delta') text += part.delta
    else if (part.type === 'error') throw new ModelSampleError(part.error)
    else if (part.type === 'finish' && part.reason === 'aborted') {
      throw new ModelSampleError({ code: 'unknown', message: 'aborted', retryable: false })
    }
  }
  return text
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

const RETRY_NUDGE = '\n\n注意：上一次输出无法解析为 JSON。请严格只输出一个合法的 JSON 对象，不要任何解释、前后缀或代码围栏。'

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
