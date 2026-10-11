import { describe, expect, it } from 'vitest'
import type { ModelCallDetail, ModelClient, SamplingPart, SamplingRequest } from '@aiwc/protocol'
import { meterModelClient } from './meteredClient'
import { redactSecrets } from './redact'

const KEY = 'sk-live-0123456789abcdef0123'

function fakeClient(parts: SamplingPart[]): ModelClient {
  return {
    ref: {
      providerId: 'p',
      modelId: 'm',
      label: 'm',
      contextWindow: 1000,
      supportsTools: true,
      supportsVision: false,
      local: false,
    },
    async *sample() {
      for (const part of parts) yield part
    },
  }
}

const request = (patch: Partial<SamplingRequest> = {}): SamplingRequest => ({
  system: `use key ${KEY}`,
  history: [],
  tools: [],
  toolChoice: 'none',
  signal: new AbortController().signal,
  ...patch,
})

async function drain(client: ModelClient, req: SamplingRequest): Promise<void> {
  for await (const _part of client.sample(req)) {
    // consume
  }
}

describe('metered model client', () => {
  it('records feature, tokens and status without content by default', async () => {
    const calls: ModelCallDetail[] = []
    let t = 1000
    const client = meterModelClient(
      fakeClient([
        { type: 'text.delta', delta: 'hi' },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 12, outputTokens: 3 } },
      ]),
      { feature: 'autoReply', providerId: 'p', secrets: [KEY] },
      { record: (c) => calls.push(c), recordContent: () => false, clock: () => (t += 10) },
    )
    await drain(client, request({ purpose: { feature: 'title' } }))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      feature: 'title',
      inputTokens: 12,
      outputTokens: 3,
      status: 'ok',
      hasContent: false,
    })
    expect(calls[0]!.request).toBeUndefined()
  })

  it('keeps redacted content while 记录内容 is on, and records failures', async () => {
    const calls: ModelCallDetail[] = []
    const client = meterModelClient(
      fakeClient([
        { type: 'text.delta', delta: 'partial' },
        { type: 'error', error: { code: 'auth', message: `bad key ${KEY}`, status: 401, retryable: false } },
      ]),
      { feature: 'agent', providerId: 'p', secrets: [KEY] },
      { record: (c) => calls.push(c), recordContent: () => true },
    )
    await drain(client, request())
    const recorded = calls[0]!
    expect(recorded).toMatchObject({ status: 'error', errorCode: 'auth', httpStatus: 401, hasContent: true })
    expect(recorded.request).toContain('[REDACTED]')
    expect(recorded.request).not.toContain(KEY)
    expect(recorded.errorMessage).not.toContain(KEY)
    expect(recorded.response).toContain('partial')
  })

  it('marks a call the consumer abandoned as aborted', async () => {
    const calls: ModelCallDetail[] = []
    const client = meterModelClient(
      fakeClient([
        { type: 'text.delta', delta: 'a' },
        { type: 'text.delta', delta: 'b' },
      ]),
      { feature: 'agent', providerId: 'p', secrets: [] },
      { record: (c) => calls.push(c), recordContent: () => false },
    )
    for await (const _part of client.sample(request())) break
    expect(calls[0]?.status).toBe('aborted')
  })
})

describe('secret redaction', () => {
  it('masks known keys, bearer tokens and api_key fields', () => {
    const text = `Authorization: Bearer abcdefghijklmnop "api_key": "zzzzzzzzzzzz" AIza${'x'.repeat(35)} mine-secret-value`
    const out = redactSecrets(text, ['mine-secret-value'])
    expect(out).not.toContain('abcdefghijklmnop')
    expect(out).not.toContain('zzzzzzzzzzzz')
    expect(out).not.toContain('AIza')
    expect(out).not.toContain('mine-secret-value')
  })
})
