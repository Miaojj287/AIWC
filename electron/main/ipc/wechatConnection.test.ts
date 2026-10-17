import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { HostBridge } from './register'
import { runKeyHost } from '../substrate/keyAcquireClient'
import { createWechatConnection } from './wechatConnection'

vi.mock('../substrate/keyAcquireClient', () => ({ runKeyHost: vi.fn() }))
function setup() {
  const config = defaultConfig()
  const ctx = {
    config: { get: () => config, set: vi.fn() },
    secrets: { reveal: vi.fn(), set: vi.fn(), delete: vi.fn() },
    substrate: { status: () => ({ connection: 'no_config' }) },
    paths: { nativeDir: '/native' },
    broadcast: vi.fn(),
    toast: vi.fn(),
  } as unknown as AppContext
  return { connection: createWechatConnection(ctx, {} as HostBridge), ctx }
}
const request = (wxid: string) => ({ wxid, dbRoot: '/fictional', scope: 'database' })

it('reports the actual locked inventory before credentials exist without starting acquisition', async () => {
  const coverage = {
    database: false,
    matched: 0,
    total: 3,
    missing: ['session/session.db', 'contact/contact.db', 'message/message_0.db'],
  }
  vi.mocked(runKeyHost).mockReset().mockResolvedValue(coverage)
  const { connection, ctx } = setup()
  expect(await connection.inspect({ wxid: 'account-a', dbRoot: '/fictional' })).toEqual({
    ...coverage,
    revision: 0,
    imageXor: false,
    imageAes: false,
  })
  expect(runKeyHost).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operation: 'inspect',
      request: { wxid: 'account-a', dbRoot: '/fictional', strategy: 'auto', scope: 'database' },
    }),
  )
  expect(ctx.secrets.set).not.toHaveBeenCalled()
  expect(ctx.broadcast).not.toHaveBeenCalled()
})

describe('explicit connection acquisition scheduling', () => {
  it('cancels every queued request before any process access starts', async () => {
    vi.mocked(runKeyHost).mockReset().mockResolvedValue({ steps: [] })
    const { connection, ctx } = setup()
    const runs = ['account-a', 'account-b', 'account-c'].map((id) => connection.acquire(request(id)))
    connection.cancel()
    await Promise.all(runs)
    expect(runKeyHost).not.toHaveBeenCalled()
    expect(ctx.broadcast).not.toHaveBeenCalled()
    expect(ctx.toast).not.toHaveBeenCalled()
  })
  it('starts only the most recent queued request', async () => {
    vi.mocked(runKeyHost).mockReset().mockResolvedValue({ steps: [] })
    const { connection } = setup()
    await Promise.all(['account-a', 'account-b', 'account-c'].map((id) => connection.acquire(request(id))))
    expect(runKeyHost).toHaveBeenCalledTimes(1)
    expect(runKeyHost).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ wxid: 'account-c' }) }),
    )
  })
  it('settles all queued work before account activation may proceed', async () => {
    vi.mocked(runKeyHost).mockReset().mockResolvedValue({ steps: [] })
    const { connection } = setup()
    const runs = ['account-a', 'account-b'].map((id) => connection.acquire(request(id)))
    await connection.settle()
    await Promise.all(runs)
    expect(runKeyHost).not.toHaveBeenCalled()
  })
  it('suppresses stale database writes and progress after a newer request', async () => {
    vi.mocked(runKeyHost).mockReset()
    let finishFirst: (() => void) | undefined
    let stale: Parameters<typeof runKeyHost>[0] | undefined
    let started: (() => void) | undefined
    const start = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.mocked(runKeyHost).mockImplementation(async (options) => {
      if (options.request.wxid !== 'account-a') return { steps: [] }
      stale = options
      started?.()
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      return { steps: [], cancelled: true }
    })
    const { connection, ctx } = setup()
    const first = connection.acquire(request('account-a'))
    await start
    const second = connection.acquire(request('account-b'))
    expect(stale?.signal?.aborted).toBe(true)
    stale?.onStep?.({ id: 'db_key', label: '', status: 'doing' })
    expect(() => stale?.onDatabase?.({ dbKeyHex: 'b'.repeat(64) })).toThrow()
    expect(ctx.broadcast).not.toHaveBeenCalled()
    expect(ctx.secrets.set).not.toHaveBeenCalled()
    finishFirst?.()
    await Promise.all([first, second])
  })
})
