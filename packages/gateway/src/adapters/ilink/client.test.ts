import { describe, expect, it } from 'vitest'
import { createIlinkClient } from './client'
import { IlinkApiError, isSessionExpiredError, type IlinkSession } from './protocol'

const session: IlinkSession = { token: 'token', baseUrl: 'https://ilink.test', botId: 'bot', userId: 'owner' }

/** A request the server never answers; it only settles when the client aborts it. */
const hang = (_input: string, init?: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), {
      once: true,
    })
  })

describe('ilink client sendText', () => {
  it('reports a timed-out send as a failure, never as delivered', async () => {
    const client = createIlinkClient({ fetch: hang, defaultTimeoutMs: 20 })
    await expect(client.sendText(session, 'friend', 'hi')).rejects.toBeInstanceOf(IlinkApiError)
  })

  it('surfaces a non-zero ret as a structured error that session-expiry detection understands', async () => {
    const client = createIlinkClient({
      fetch: async () => new Response(JSON.stringify({ ret: -14, errmsg: 'session timeout' })),
    })
    const error: unknown = await client.sendText(session, 'friend', 'hi').catch((e: unknown) => e)
    expect(error).toMatchObject({ ret: -14 })
    expect(isSessionExpiredError(error)).toBe(true)
  })

  it('resolves with the client id when the server accepts the message', async () => {
    const client = createIlinkClient({ fetch: async () => new Response(JSON.stringify({ ret: 0 })) })
    await expect(client.sendText(session, 'friend', 'hi')).resolves.toMatchObject({
      clientId: expect.stringMatching(/^aiwc-/),
      ret: 0,
    })
  })
})
