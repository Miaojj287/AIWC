/**
 * Test-only harness for IPC registrars: collects what a `register*Ipc` function installs through
 * `Handle`, then calls those handlers by channel the way `ipcMain` would (without an event object).
 */
import type { InvokeChannel, InvokeReq, InvokeRes } from '@aiwc/protocol'
import type { Handle } from '../register'

/**
 * `Handler<K>` is contravariant in `K`, so a map holding every channel's handler can only keep the
 * erased signature. The cast lives here once instead of in every IPC test.
 */
type ErasedHandler = (req: unknown) => unknown

export interface HandlerHarness {
  /** Pass to `register*Ipc(ctx, host, handle)`. */
  readonly handle: Handle
  /** Typed call. Synchronous handlers return synchronously, exactly like the real handler. */
  invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): InvokeRes<K> | Promise<InvokeRes<K>>
  /** Untyped call, for tests that feed malformed renderer input. */
  invokeRaw(channel: InvokeChannel, req: unknown): unknown
}

export function createHandlerHarness(): HandlerHarness {
  const handlers = new Map<InvokeChannel, ErasedHandler>()
  const call = (channel: InvokeChannel, req: unknown): unknown => {
    const fn = handlers.get(channel)
    if (!fn) throw new Error(`no handler registered for ${channel}`)
    return fn(req)
  }
  return {
    handle: (channel, fn) => {
      handlers.set(channel, fn as unknown as ErasedHandler)
    },
    invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>) {
      return call(channel, req) as InvokeRes<K> | Promise<InvokeRes<K>>
    },
    invokeRaw: call,
  }
}
