import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinishReason, ModelClient, ModelError, SamplingPart, SamplingRequest } from '@aiwc/protocol'
import { retryDelayMs, retryReasonFor, sampleResilient, type ResilientPart } from './resilientSample'

type Attempt =
  | { kind: 'text'; text: string; finish?: FinishReason }
  | { kind: 'error'; error: ModelError }
  | { kind: 'hang' }
  | { kind: 'textThenHang'; text: string }
  | { kind: 'delayed'; ms: number; text: string }

function scripted(attempts: Attempt[], local = true): ModelClient & { calls: number } {
  const client = {
    calls: 0,
    ref: {
      providerId: 'p',
      modelId: 'm',
      label: 'M',
      contextWindow: 1000,
      supportsTools: true,
      supportsVision: false,
      local,
    },
    async *sample(req: SamplingRequest): AsyncIterable<SamplingPart> {
      const attempt = attempts[client.calls++] ?? { kind: 'text', text: '' }
      const usage = { inputTokens: 1, outputTokens: 1 }
      const hang = () =>
        new Promise<void>((resolve) => req.signal.addEventListener('abort', () => resolve(), { once: true }))
      switch (attempt.kind) {
        case 'text':
          yield { type: 'text.delta', delta: attempt.text }
          yield { type: 'finish', reason: attempt.finish ?? 'stop', usage }
          return
        case 'error':
          yield { type: 'error', error: attempt.error }
          return
        case 'hang':
          await hang()
          yield { type: 'finish', reason: 'aborted', usage }
          return
        case 'delayed':
          await new Promise<void>((resolve) => setTimeout(resolve, attempt.ms))
          if (req.signal.aborted) {
            yield { type: 'finish', reason: 'aborted', usage }
            return
          }
          yield { type: 'text.delta', delta: attempt.text }
          yield { type: 'finish', reason: 'stop', usage }
          return
        case 'textThenHang':
          yield { type: 'text.delta', delta: attempt.text }
          await hang()
          yield { type: 'finish', reason: 'aborted', usage }
          return
      }
    },
  }
  return client
}

const request = (signal: AbortSignal = new AbortController().signal): SamplingRequest => ({
  system: '',
  history: [],
  tools: [],
  toolChoice: 'none',
  signal,
})

async function collect(iterable: AsyncIterable<ResilientPart>): Promise<ResilientPart[]> {
  const out: ResilientPart[] = []
  for await (const part of iterable) out.push(part)
  return out
}

const waits: number[] = []
const fast = {
  resilience: { firstChunkTimeoutMs: 30, idleTimeoutMs: 30 },
  sleep: async (ms: number) => {
    waits.push(ms)
  },
  random: () => 0.5,
}

describe('sampleResilient', () => {
  it('classifies retryable failures by code and status only', () => {
    expect(retryReasonFor({ code: 'rate_limit', message: '', retryable: true })).toBe('rate_limit')
    expect(retryReasonFor({ code: 'network', message: '', status: 502, retryable: true })).toBe('server')
    expect(retryReasonFor({ code: 'network', message: 'fetch failed', retryable: true })).toBe('network')
    expect(retryReasonFor({ code: 'auth', message: 'timeout', retryable: false })).toBeUndefined()
    expect(retryReasonFor({ code: 'unknown', message: 'network', retryable: false })).toBeUndefined()
    expect(retryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000 }, undefined, () => 0.5)).toBe(1000)
    expect(retryDelayMs(3, { baseDelayMs: 1000, maxDelayMs: 30_000 }, undefined, () => 0.5)).toBe(4000)
    expect(retryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 30_000 }, 9000, () => 0.5)).toBe(9000)
  })

  it('retries a rate limit after at least Retry-After and then streams the answer', async () => {
    waits.length = 0
    const model = scripted([
      {
        kind: 'error',
        error: { code: 'rate_limit', message: '429', status: 429, retryable: true, retryAfterMs: 5000 },
      },
      { kind: 'text', text: 'ok' },
    ])
    const parts = await collect(sampleResilient(model, request(), fast))
    expect(parts[0]).toEqual({ type: 'restart', attempt: 1, max: 3, reason: 'rate_limit', delayMs: 5000 })
    expect(parts.slice(1).map((p) => p.type)).toEqual(['text.delta', 'finish'])
    expect(waits).toEqual([5000])
  })

  it('treats a silent stream as stalled, drops the partial attempt and gives up after m retries', async () => {
    const model = scripted([{ kind: 'textThenHang', text: 'par' }, { kind: 'hang' }, { kind: 'text', text: 'full' }])
    const parts = await collect(sampleResilient(model, request(), fast))
    expect(parts.map((p) => (p.type === 'restart' ? `restart:${p.reason}:${p.attempt}/${p.max}` : p.type))).toEqual([
      'text.delta',
      'restart:stalled:1/3',
      'restart:stalled:2/3',
      'text.delta',
      'finish',
    ])

    const dead = scripted([{ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }])
    const end = await collect(sampleResilient(dead, request(), fast))
    expect(end.filter((p) => p.type === 'restart')).toHaveLength(3)
    expect(end[end.length - 1]).toMatchObject({ type: 'error', error: { code: 'stream_stalled' } })
    expect(dead.calls).toBe(4)
  })

  it('never retries what a retry cannot fix, nor a server wait longer than the cap', async () => {
    const auth = scripted([{ kind: 'error', error: { code: 'auth', message: '401', status: 401, retryable: false } }])
    expect((await collect(sampleResilient(auth, request(), fast))).map((p) => p.type)).toEqual(['error'])
    expect(auth.calls).toBe(1)

    const longWait = scripted([
      { kind: 'error', error: { code: 'rate_limit', message: '429', retryable: true, retryAfterMs: 10 * 60_000 } },
    ])
    expect((await collect(sampleResilient(longWait, request(), fast))).map((p) => p.type)).toEqual(['error'])
  })

  it('stops at once when the caller aborts, without retrying', async () => {
    const controller = new AbortController()
    const model = scripted([{ kind: 'hang' }, { kind: 'text', text: 'never' }])
    setTimeout(() => controller.abort(), 5)
    const parts = await collect(
      sampleResilient(model, request(controller.signal), { ...fast, resilience: { firstChunkTimeoutMs: 1000 } }),
    )
    expect(parts).toEqual([{ type: 'finish', reason: 'aborted', usage: { inputTokens: 1, outputTokens: 1 } }])
    expect(model.calls).toBe(1)
  })

  it('returns aborted without calling the model when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const model = scripted([{ kind: 'hang' }])
    const parts = await collect(sampleResilient(model, request(controller.signal), fast))
    expect(parts).toEqual([{ type: 'finish', reason: 'aborted', usage: { inputTokens: 0, outputTokens: 0 } }])
    expect(model.calls).toBe(0)
  })

  it('stops instead of retrying when the caller aborts during the backoff wait', async () => {
    const controller = new AbortController()
    const model = scripted([{ kind: 'error', error: { code: 'network', message: 'x', retryable: true } }])
    const parts = await collect(
      sampleResilient(model, request(controller.signal), {
        ...fast,
        sleep: async () => {
          controller.abort()
        },
      }),
    )
    expect(parts.map((p) => p.type)).toEqual(['restart', 'finish'])
    expect(parts[1]).toMatchObject({ reason: 'aborted' })
    expect(model.calls).toBe(1)
  })

  describe('first-chunk deadline', () => {
    afterEach(() => {
      vi.useRealTimers()
    })
    const noWait = { sleep: async () => undefined, random: () => 0.5 }

    it('gives a local model unlimited prefill time before its first token', async () => {
      vi.useFakeTimers()
      const model = scripted([{ kind: 'delayed', ms: 240_000, text: 'ok' }], true)
      const done = collect(sampleResilient(model, request(), noWait))
      await vi.advanceTimersByTimeAsync(240_000)
      expect((await done).map((p) => p.type)).toEqual(['text.delta', 'finish'])
      expect(model.calls).toBe(1)
    })

    it('still treats a silent online model as stalled after the first-chunk deadline', async () => {
      vi.useFakeTimers()
      const model = scripted(
        [
          { kind: 'delayed', ms: 240_000, text: 'late' },
          { kind: 'text', text: 'ok' },
        ],
        false,
      )
      const done = collect(sampleResilient(model, request(), noWait))
      await vi.advanceTimersByTimeAsync(240_000)
      const parts = await done
      expect(parts[0]).toMatchObject({ type: 'restart', reason: 'stalled' })
      expect(model.calls).toBe(2)
    })
  })
})
