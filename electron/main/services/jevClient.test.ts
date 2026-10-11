import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AppConfig } from '@aiwc/protocol'
import { JevClientError, createJevClient, normaliseBaseUrl } from './jevClient'

type FetchLike = typeof fetch

const answer = {
  model: 'jev-1.13.0',
  answers: {
    reply: { type: 'choice', choice: 'c1', probabilities: { c1: 0.8, none: 0.2 }, confidence: 0.75 },
    needs_reply: { type: 'noul', noul: 0.9 },
  },
  usage: { input_tokens: 300, output_tokens: 20 },
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function setup(
  opts: { key?: string | null; fetch: FetchLike; config?: (c: AppConfig) => AppConfig } = { fetch: vi.fn() },
) {
  const base = defaultConfig()
  const withKey: AppConfig = { ...base, ai: { ...base.ai, jev: { ...base.ai.jev, apiKeyRef: 'ai.jev.apiKey' } } }
  const config = opts.config ? opts.config(withKey) : withKey
  const secrets = {
    reveal: vi.fn((ref: string) => (ref === 'ai.jev.apiKey' ? (opts.key === undefined ? 'sk-test' : opts.key) : null)),
  }
  let now = 1_000
  const client = createJevClient({
    config: () => config,
    secrets,
    fetch: opts.fetch,
    now: () => (now += 5),
    sleep: async () => {},
  })
  return { client, secrets }
}

afterEach(() => vi.restoreAllMocks())

describe('createJevClient', () => {
  it('posts state + questions with the bearer key and returns the validated answers', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => response(200, answer))
    const { client } = setup({ fetch: fetchMock })
    const result = await client.ask(
      { incoming: 'hi' },
      { reply: { type: 'choice', instructions: 'q', criteria: { c1: 'x' } } },
    )
    expect(result.answers.reply).toMatchObject({ type: 'choice', choice: 'c1', confidence: 0.75 })
    expect(result.usage?.input_tokens).toBe(300)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'jev-latest',
      state: { incoming: 'hi' },
      questions: { reply: { type: 'choice', instructions: 'q', criteria: { c1: 'x' } } },
    })
  })

  it('refuses without a key, before any network call', async () => {
    const fetchMock = vi.fn<FetchLike>()
    const { client } = setup({ fetch: fetchMock, key: null })
    expect(client.configured()).toBe(false)
    await expect(client.ask('s', {})).rejects.toMatchObject({ code: 'no_key' })
    expect(await client.test()).toMatchObject({ ok: false, code: 'no_key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps HTTP failures to stable codes with a user-facing sentence', async () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [422, 'invalid_request'],
      [500, 'server'],
    ]
    for (const [status, code] of cases) {
      const { client } = setup({
        fetch: vi.fn<FetchLike>(async () => response(status, { error: { message: 'bad field' } })),
      })
      const error = await client.ask('s', {}).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(JevClientError)
      expect((error as JevClientError).code).toBe(code)
      expect((error as JevClientError).message.length).toBeGreaterThan(0)
    }
  })

  it('retries once on 429 / 529, honouring a short retry-after, then gives up', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(response(429, { message: 'slow down' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(response(200, answer))
    const { client } = setup({ fetch: fetchMock })
    await expect(client.ask('s', {})).resolves.toMatchObject({ model: 'jev-1.13.0' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const overloaded = vi.fn<FetchLike>(async () => response(529, 'overloaded'))
    const again = setup({ fetch: overloaded })
    await expect(again.client.ask('s', {})).rejects.toMatchObject({ code: 'overloaded' })
    expect(overloaded).toHaveBeenCalledTimes(2)
  })

  it('rejects a response that does not match the schema instead of using it', async () => {
    const { client } = setup({
      fetch: vi.fn<FetchLike>(async () => response(200, { model: 'x', answers: { reply: { type: 'choice' } } })),
    })
    await expect(client.ask('s', {})).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reports an abort / network failure without leaking the request', async () => {
    const { client } = setup({
      fetch: vi.fn<FetchLike>(async () => {
        throw new TypeError('fetch failed: ECONNREFUSED')
      }),
    })
    const error = await client.ask('s', {}).catch((e: unknown) => e)
    expect((error as JevClientError).code).toBe('network')
    expect((error as JevClientError).message).toContain('ECONNREFUSED')
  })

  it('test() lists the models the key can use, from a typed key when given, against the configured endpoint', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      response(200, { models: [{ name: 'jev-latest' }, { name: 'jev-preview' }] }),
    )
    const { client } = setup({
      fetch: fetchMock,
      key: null,
      config: (c) => ({ ...c, ai: { ...c.ai, jev: { ...c.ai.jev, baseUrl: 'https://proxy.example/typesafe/' } } }),
    })
    const result = await client.test({ apiKey: 'sk-typed' })
    expect(result).toMatchObject({ ok: true, models: ['jev-latest', 'jev-preview'] })
    expect(result.latencyMs).toBeGreaterThan(0)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://proxy.example/typesafe/v1/models')
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-typed')
  })
})

describe('normaliseBaseUrl', () => {
  it('trims trailing slashes and falls back to the default', () => {
    expect(normaliseBaseUrl(undefined)).toBe('https://api.typesafe.ai')
    expect(normaliseBaseUrl('  ')).toBe('https://api.typesafe.ai')
    expect(normaliseBaseUrl('https://a.b/v1//')).toBe('https://a.b/v1')
  })
})
