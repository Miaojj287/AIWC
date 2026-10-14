import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatKeyHostOutput } from '@aiwc/protocol'
import { createKeyAcquireRuntime } from './keyAcquireRuntime'

const input = {
  type: 'init',
  request: { wxid: 'fictional-account', dbRoot: '/fictional', strategy: 'auto', scope: 'database' },
  nativeDir: '/fictional',
  operation: 'acquire',
} as const
const database = { dbKeyHex: 'b'.repeat(64) }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('acquisition utility persistence handshake', () => {
  it('waits for persistence before continuing and waits for delivery before exiting', async () => {
    const messages: WechatKeyHostOutput[] = []
    const exit = vi.fn()
    const continued = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post: (message) => messages.push(message),
      exit,
      inspect: vi.fn(),
      acquire: async (options) => {
        await options.onDatabaseReady?.(database)
        continued()
        return { steps: [], ...database }
      },
    })
    runtime.receive(input)
    await Promise.resolve()
    expect(messages.map((message) => message.type)).toEqual(['database'])
    expect(continued).not.toHaveBeenCalled()
    runtime.receive({ type: 'database_ack', accepted: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(continued).toHaveBeenCalledOnce()
    expect(messages.map((message) => message.type)).toEqual(['database', 'result'])
    expect(exit).not.toHaveBeenCalled()
    runtime.receive({ type: 'final_ack' })
    expect(exit).toHaveBeenCalledOnce()
  })

  it('rejects a failed save and never continues to optional native work', async () => {
    const continued = vi.fn()
    const exit = vi.fn()
    const post = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post,
      exit,
      inspect: vi.fn(),
      acquire: async (options) => {
        await options.onDatabaseReady?.(database)
        continued()
        return { steps: [] }
      },
    })
    runtime.receive(input)
    runtime.receive({ type: 'database_ack', accepted: false })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(continued).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith({ type: 'failed' })
    runtime.receive({ type: 'final_ack' })
    expect(exit).toHaveBeenCalledOnce()
  })

  it('aborts on parent disconnect and does not exit before acquisition cleanup', async () => {
    let release: () => void = () => {}
    let signal: AbortSignal | undefined
    const exit = vi.fn()
    const post = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post,
      exit,
      inspect: vi.fn(),
      acquire: async (options) => {
        signal = options.signal
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { steps: [], cancelled: true }
      },
    })
    runtime.receive(input)
    runtime.disconnect()
    expect(signal?.aborted).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(post).toHaveBeenLastCalledWith({ type: 'result', result: { steps: [], cancelled: true } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('drops private diagnostic strings before crossing the port', async () => {
    const post = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post,
      exit: vi.fn(),
      inspect: vi.fn(),
      acquire: async (options) => {
        const step = {
          id: 'db_key',
          label: 'SYNTHETIC_PRIVATE_MARKER',
          status: 'failed',
          detail: 'SYNTHETIC_PRIVATE_MARKER',
          failure: 'not_found',
        } as const
        options.onStep(step)
        return { steps: [step] }
      },
    })
    runtime.receive(input)
    await Promise.resolve()
    expect(JSON.stringify(post.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_MARKER')
    runtime.receive({ type: 'final_ack' })
  })

  it('cancels active work on malformed input and waits for its cleanup before final failure', async () => {
    let release: () => void = () => {}
    let signal: AbortSignal | undefined
    const post = vi.fn()
    const exit = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post,
      exit,
      inspect: vi.fn(),
      acquire: async (options) => {
        signal = options.signal
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { steps: [], cancelled: true }
      },
    })
    runtime.receive(input)
    runtime.receive({ type: 'invalid', detail: 'SYNTHETIC_PRIVATE_MARKER' })
    expect(signal?.aborted).toBe(true)
    expect(post).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(post).toHaveBeenLastCalledWith({ type: 'failed' })
    runtime.receive({ type: 'final_ack' })
    expect(exit).toHaveBeenCalledOnce()
  })

  it('times out an unacknowledged save and blocks the remaining native work', async () => {
    const continued = vi.fn()
    const post = vi.fn()
    const runtime = createKeyAcquireRuntime({
      post,
      exit: vi.fn(),
      inspect: vi.fn(),
      acquire: async (options) => {
        await options.onDatabaseReady?.(database)
        continued()
        return { steps: [] }
      },
    })
    runtime.receive(input)
    await vi.advanceTimersByTimeAsync(5000)
    expect(continued).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith({ type: 'failed' })
    runtime.receive({ type: 'final_ack' })
  })
})
