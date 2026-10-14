import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { utilityProcess } from 'electron'
import { runKeyHost } from './keyAcquireClient'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }))

class FakeHost extends EventEmitter {
  pid = 1
  stderr = null
  stdout = null
  postMessage = vi.fn()
  kill = vi.fn(() => true)
}

const request = { wxid: 'fictional-account', dbRoot: '/fictional', strategy: 'auto', scope: 'database' } as const
const database = { dbKeyHex: 'b'.repeat(64) }
let child: FakeHost
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(utilityProcess.fork).mockClear()
  child = new FakeHost()
  vi.mocked(utilityProcess.fork).mockReturnValue(child as ReturnType<typeof utilityProcess.fork>)
})
afterEach(() => vi.useRealTimers())

const start = (extra: Partial<Parameters<typeof runKeyHost>[0]> = {}) => {
  const promise = runKeyHost({
    entry: '/fictional/keyAcquireHost.js',
    nativeDir: '/fictional',
    request,
    operation: 'acquire',
    ...extra,
  })
  child.emit('spawn')
  return promise
}

describe('private acquisition host lifecycle', () => {
  it('acknowledges database material only after persistence succeeds', async () => {
    let resolveSave: () => void = () => {}
    const onDatabase = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const run = start({ onDatabase })
    const ready = { ...database, currentPaths: ['session/session.db', 'message/message_0.db'] }
    child.emit('message', { type: 'database', database: ready })
    await Promise.resolve()
    expect(onDatabase).toHaveBeenCalledWith(ready)
    expect(child.postMessage).not.toHaveBeenCalledWith({ type: 'database_ack', accepted: true })
    resolveSave()
    await Promise.resolve()
    await Promise.resolve()
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'database_ack', accepted: true })
    child.emit('message', { type: 'result', result: { steps: [], ...database } })
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('exit', 0)
    await expect(run).resolves.toMatchObject(database)
  })

  it('cancels after persistence failure, waits for cleanup, and preserves a safe failure code', async () => {
    const onDatabase = vi.fn(() => {
      throw new Error('SYNTHETIC_PRIVATE_MARKER')
    })
    const run = start({ onDatabase })
    const failure = run.catch((error: unknown) => error)
    child.emit('message', { type: 'database', database })
    await Promise.resolve()
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'database_ack', accepted: false })
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('exit', 0)
    expect(await failure).toMatchObject({ message: 'KEY_HOST_SAVE_FAILED' })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps user cancellation as AbortError when the utility exits first', async () => {
    const controller = new AbortController()
    const run = start({ signal: controller.signal })
    const failure = run.catch((error: unknown) => error)
    controller.abort()
    child.emit('exit', 0)
    expect(await failure).toMatchObject({ name: 'AbortError' })
  })

  it('force-kills only after the cleanup grace period', async () => {
    const controller = new AbortController()
    const run = start({ signal: controller.signal })
    const failure = run.catch((error: unknown) => error)
    controller.abort()
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1999)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledOnce()
    expect(await failure).toMatchObject({ name: 'AbortError' })
  })

  it('does not fork when cancelled before starting', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runKeyHost({
        entry: '/fictional',
        nativeDir: '/fictional',
        request,
        operation: 'acquire',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(utilityProcess.fork).not.toHaveBeenCalled()
  })

  it('rejects a result that arrives before database persistence is acknowledged', async () => {
    const run = start({ onDatabase: () => new Promise<void>(() => {}) })
    const failure = run.catch((error: unknown) => error)
    child.emit('message', { type: 'database', database })
    child.emit('message', { type: 'result', result: { steps: [], ...database } })
    child.emit('exit', 0)
    expect(await failure).toMatchObject({ message: 'INVALID_KEY_HOST_RESULT' })
  })

  it('filters arbitrary diagnostic text from progress and final results', async () => {
    const onStep = vi.fn()
    const run = start({ onStep })
    const step = {
      id: 'db_key',
      label: 'SYNTHETIC_PRIVATE_MARKER',
      status: 'failed',
      detail: 'SYNTHETIC_PRIVATE_MARKER',
      failure: 'not_found',
    }
    child.emit('message', { type: 'step', step })
    expect(onStep).toHaveBeenCalledWith({ id: 'db_key', label: '', status: 'failed', failure: 'not_found' })
    child.emit('message', { type: 'result', result: { steps: [step] } })
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'final_ack' })
    child.emit('exit', 0)
    const result = await run
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_MARKER')
  })

  it('rejects out-of-scope host messages without leaking their contents', async () => {
    const run = start()
    const failure = run.catch((error: unknown) => error)
    child.emit('message', { type: 'coverage', result: { database: false, matched: 0, total: 0, missing: [] } })
    child.emit('exit', 0)
    expect(await failure).toMatchObject({ message: 'INVALID_KEY_HOST_RESULT' })
  })
})
