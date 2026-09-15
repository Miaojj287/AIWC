import type { ModelClient, SamplingPart, SamplingRequest } from '@aiwc/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScriptedModel } from '../testing/fakes'
import { MODEL_CALL_TIMEOUT_MS, ModelSampleError, sampleText } from './model'

/** A provider whose stream never yields and never looks at the abort signal (the worst case: a stalled socket). */
function hungModel(): ModelClient & { requests: SamplingRequest[] } {
  const requests: SamplingRequest[] = []
  return {
    requests,
    ref: {
      providerId: 'fake',
      modelId: 'hung',
      label: 'hung',
      contextWindow: 8_000,
      supportsTools: false,
      supportsVision: false,
      local: true,
    },
    sample(req) {
      requests.push(req)
      return {
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SamplingPart>>(() => {}) }),
      }
    },
  }
}

describe('sampleText deadlines', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails a call whose stream never finishes once the default timeout elapses', async () => {
    vi.useFakeTimers()
    const model = hungModel()
    let outcome: unknown = 'pending'
    const done = sampleText(model, 'system', 'user').then(
      (text) => (outcome = text),
      (e: unknown) => (outcome = e),
    )
    await vi.advanceTimersByTimeAsync(MODEL_CALL_TIMEOUT_MS - 1)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(outcome).toBeInstanceOf(ModelSampleError)
    expect((outcome as ModelSampleError).error).toMatchObject({ code: 'network', retryable: true })
    expect((outcome as ModelSampleError).message).toContain('timed out')
    // the provider was told to stop, and nothing is left scheduled
    expect(model.requests[0]?.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('combines the caller signal with the deadline and honours a per-call timeout', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const aborted = sampleText(hungModel(), 'system', 'user', { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    const err = await aborted
    expect(err).toBeInstanceOf(ModelSampleError)
    expect((err as ModelSampleError).message).toBe('aborted')
    expect(vi.getTimerCount()).toBe(0)

    const already = hungModel()
    await expect(sampleText(already, 's', 'u', { signal: controller.signal })).rejects.toThrow('aborted')
    expect(already.requests).toHaveLength(0)

    const short = sampleText(hungModel(), 's', 'u', { timeoutMs: 1_000 }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await short).toMatchObject({ error: { code: 'network' } })
  })

  it('still collects a normal stream and clears its deadline', async () => {
    vi.useFakeTimers()
    const model = createScriptedModel(() => '一段正常的回复文本')
    expect(await sampleText(model, 'system', 'user')).toBe('一段正常的回复文本')
    expect(vi.getTimerCount()).toBe(0)
  })
})
