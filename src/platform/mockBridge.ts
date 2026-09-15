/**
 * Web-only mock of AiwcBridge over dev/fixtures/demo-dataset.json.
 *
 * Implements every InvokeMap channel with in-memory state (config / memory / secrets persist in
 * localStorage) and pushes EventMap events with realistic timing. Only tests and the dev previews in
 * dev/fixtures install it; the app's bridge (src/platform/bridge.ts) never falls back to it. Tests pass
 * `{ timeScale: 0 }` to make every delay resolve immediately.
 */
import { INVOKE_CHANNELS, type AiwcBridge, type InvokeChannel, type InvokeReq, type InvokeRes } from '@aiwc/protocol'
// eslint-disable-next-line boundaries/element-types -- demo data lives in dev/fixtures; this module is imported only by tests and dev previews (ARCHITECTURE §11)
import rawFixture from '../../dev/fixtures/demo-dataset.json'
import { createMockContext, type Handlers, type MockOptions } from './mock/core'
import type { DemoFixture } from './mock/types'
import { substrateHandlers } from './mock/substrate'
import { agentHandlers } from './mock/agent'
import { memoryHandlers } from './mock/memory'
import { cloneHandlers } from './mock/clone'
import { autoreplyHandlers } from './mock/autoreply'
import { miscHandlers } from './mock/misc'
import { petHandlers } from './mock/pets'
import { taskHandlers } from './mock/tasks'

const allowedChannels = new Set<string>(INVOKE_CHANNELS)

export type MockBridgeOptions = Partial<MockOptions>

export interface MockBridge extends AiwcBridge {
  readonly runtime: 'web'
  /** Exposed for tests and dev tooling; not part of the IPC contract. */
  readonly handlers: Handlers
}

export const demoFixture = rawFixture as unknown as DemoFixture

export function createMockBridge(options: MockBridgeOptions = {}): MockBridge {
  const ctx = createMockContext({ fixture: options.fixture ?? demoFixture, ...options })

  const substrate = substrateHandlers(ctx)
  const agent = agentHandlers(ctx)
  const memory = memoryHandlers(ctx)
  const autoreply = autoreplyHandlers(ctx)
  const clone = cloneHandlers(ctx, { agent, rules: autoreply.rules })
  const misc = miscHandlers(ctx)
  const pets = petHandlers(ctx)
  const tasks = taskHandlers(ctx)

  // Spreading module objects also copies their helper methods (state, rules, …); pick handlers only.
  const handlers: Handlers = {
    ...pickChannels(substrate),
    ...pickChannels(agent),
    ...pickChannels(memory),
    ...pickChannels(autoreply),
    ...pickChannels(clone),
    ...pickChannels(misc),
    ...pickChannels(pets),
    ...pickChannels(tasks),
  } as Handlers

  return {
    runtime: 'web',
    platform: ctx.platform,
    handlers,
    async invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> {
      // Mirror the preload's allow-list check. Without it the web preview happily serves a channel
      // that the real bridge would reject, so a channel missing from INVOKE_CHANNELS looks fine in
      // the browser and only fails in the packaged app.
      if (!allowedChannels.has(channel)) throw new Error(`unknown ipc channel: ${channel}`)
      const handler = handlers[channel] as ((r: InvokeReq<K>) => Promise<InvokeRes<K>> | InvokeRes<K>) | undefined
      if (!handler) throw new Error(`[mockBridge] unknown channel: ${channel}`)
      return handler(req)
    },
    on: ctx.on,
  }
}

function pickChannels<T extends object>(module: T): Partial<Handlers> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(module))
    if (key.includes(':') && typeof value === 'function') out[key] = value
  return out
}
