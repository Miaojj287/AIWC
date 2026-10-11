/**
 * Wraps a ModelClient so every sample() is recorded in usage.db (设置 › 用量与记录): feature, model, tokens, latency
 * and status always; the redacted request / response only while 记录内容 is on. The wrapper never changes what the
 * caller sees: parts pass through untouched and a recording failure is logged, not thrown.
 */
import { randomUUID } from 'node:crypto'
import {
  CALL_LOG_CONTENT_MAX_CHARS,
  type ModelCallDetail,
  type ModelClient,
  type ModelError,
  type ModelUsageFeature,
  type SamplingRequest,
  type TokenUsage,
} from '@aiwc/protocol'
import { redactSecrets } from './redact'

/** Strings longer than this inside a recorded request are cut (tool outputs, pasted documents). */
const FIELD_MAX_CHARS = 8_000

export interface MeterDeps {
  record(call: ModelCallDetail): void
  /** Read per call: turning 记录内容 on or off applies to the next request. */
  recordContent(): boolean
  clock?: () => number
  onError?(err: unknown): void
}

export interface MeterOptions {
  /** Feature used when the request does not say (`SamplingRequest.purpose`). */
  feature: ModelUsageFeature
  providerId: string
  /** Values masked wherever they appear in recorded text (the provider's API key). */
  secrets: readonly (string | undefined)[]
}

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…[+${text.length - max}]` : text

/** Request as JSON, without binary attachments and with long fields shortened. */
export function serializeRequest(req: SamplingRequest): string {
  return JSON.stringify(
    { system: req.system, tools: req.tools.map((t) => t.name), history: req.history },
    (key, value: unknown) => {
      if (key === 'data' && typeof value === 'string') return `[${value.length} bytes]`
      if (typeof value === 'string') return cut(value, FIELD_MAX_CHARS)
      return value
    },
    1,
  )
}

export function meterModelClient(client: ModelClient, opts: MeterOptions, deps: MeterDeps): ModelClient {
  const clock = deps.clock ?? Date.now
  const redactText = (text: string): string => cut(redactSecrets(text, opts.secrets), CALL_LOG_CONTENT_MAX_CHARS)

  async function* sample(req: SamplingRequest) {
    const started = clock()
    const capture = deps.recordContent()
    let firstPartAt: number | undefined
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let status: ModelCallDetail['status'] | undefined
    let error: ModelError | undefined
    let text = ''
    let reasoning = ''
    const toolCalls: Array<{ name: string; input: unknown }> = []
    try {
      for await (const part of client.sample(req)) {
        firstPartAt ??= clock()
        switch (part.type) {
          case 'text.delta':
            if (capture) text += part.delta
            break
          case 'reasoning.delta':
            if (capture) reasoning += part.delta
            break
          case 'tool_call':
            if (capture) toolCalls.push({ name: part.name, input: part.input })
            break
          // the finished call (tool_call) is what the log keeps; the argument stream is display only
          case 'tool_input.delta':
            break
          case 'finish':
            usage = part.usage
            status = part.reason === 'aborted' ? 'aborted' : part.reason === 'error' ? 'error' : 'ok'
            break
          case 'error':
            status = 'error'
            error = part.error
            break
        }
        yield part
      }
    } catch (err) {
      status = req.signal.aborted ? 'aborted' : 'error'
      throw err
    } finally {
      try {
        deps.record({
          id: randomUUID(),
          at: started,
          feature: req.purpose?.feature ?? opts.feature,
          providerId: opts.providerId,
          modelId: client.ref.modelId,
          local: client.ref.local,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          reasoningTokens: usage.reasoningTokens,
          latencyMs: clock() - started,
          firstTokenMs: firstPartAt === undefined ? undefined : firstPartAt - started,
          // The consumer stopped iterating before a finish part: the call was cut short.
          status: status ?? 'aborted',
          errorCode: error?.code,
          httpStatus: error?.status,
          errorMessage: error ? redactSecrets(error.message, opts.secrets) : undefined,
          hasContent: capture,
          ...(capture
            ? {
                request: redactText(serializeRequest(req)),
                response: redactText(JSON.stringify({ text, ...(reasoning ? { reasoning } : {}), toolCalls }, null, 1)),
              }
            : {}),
        })
      } catch (err) {
        deps.onError?.(err)
      }
    }
  }

  const countTokens = client.countTokens?.bind(client)
  return { ref: client.ref, sample, ...(countTokens ? { countTokens } : {}) }
}
