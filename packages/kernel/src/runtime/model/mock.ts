/**
 * Scripted ModelClient for tests and the web mock. Each step of the script is one sampling request; text is
 * streamed in small deltas so interruption mid-stream can be exercised.
 */
import type { ModelClient, ModelError, ModelRef, SamplingPart, SamplingRequest, TokenUsage } from '@aiwc/protocol'
import { sleep } from '../util/deferred'

export interface MockToolCall {
  name: string
  input: unknown
  callId?: string
}

export interface MockStep {
  text?: string
  reasoning?: string
  toolCalls?: MockToolCall[]
  usage?: Partial<TokenUsage>
  /** Emit this error instead of a normal finish. */
  error?: ModelError
  /** Delay between deltas (ms). Default 0 (still yields to the event loop). */
  delayMs?: number
  chunkSize?: number
}

export type MockScript = MockStep[] | { steps: MockStep[]; ref?: Partial<ModelRef>; loopLast?: boolean }

export interface MockModelClient extends ModelClient {
  readonly requests: SamplingRequest[]
  reset(): void
}

let mockCallSeq = 0

export function createMockModelClient(script: MockScript): MockModelClient {
  const steps = Array.isArray(script) ? script : script.steps
  const loopLast = Array.isArray(script) ? false : script.loopLast === true
  const refOverride = Array.isArray(script) ? {} : (script.ref ?? {})
  const ref: ModelRef = {
    providerId: 'mock',
    modelId: 'mock-model',
    label: 'Mock',
    contextWindow: 32_000,
    supportsTools: true,
    supportsVision: false,
    local: true,
    ...refOverride,
  }
  const requests: SamplingRequest[] = []
  let cursor = 0

  async function* sample(req: SamplingRequest): AsyncIterable<SamplingPart> {
    requests.push(req)
    let step = steps[cursor]
    if (!step && loopLast && steps.length > 0) step = steps[steps.length - 1]
    cursor++
    const delay = step?.delayMs ?? 0
    const chunk = step?.chunkSize ?? 4
    const usage: TokenUsage = { inputTokens: 10, outputTokens: 5, ...(step?.usage ?? {}) }
    if (!step) {
      yield { type: 'finish', reason: 'stop', usage }
      return
    }
    if (step.reasoning) yield { type: 'reasoning.delta', delta: step.reasoning }
    const text = step.text ?? ''
    for (let i = 0; i < text.length; i += chunk) {
      if (req.signal.aborted) {
        yield { type: 'finish', reason: 'aborted', usage }
        return
      }
      yield { type: 'text.delta', delta: text.slice(i, i + chunk) }
      await sleep(delay, req.signal)
    }
    if (req.signal.aborted) {
      yield { type: 'finish', reason: 'aborted', usage }
      return
    }
    if (step.error) {
      yield { type: 'error', error: step.error }
      return
    }
    for (const call of step.toolCalls ?? []) {
      yield { type: 'tool_call', callId: call.callId ?? `mock_call_${++mockCallSeq}`, name: call.name, input: call.input }
    }
    yield { type: 'finish', reason: step.toolCalls?.length ? 'tool_calls' : 'stop', usage }
  }

  return {
    ref,
    requests,
    sample,
    reset() {
      cursor = 0
      requests.length = 0
    },
  }
}
