/**
 * Web-only mock of AiwcBridge over dev/fixtures/demo-dataset.json.
 *
 * Implements every InvokeMap channel with in-memory state (config / memory / secrets persist in
 * localStorage) and pushes EventMap events with realistic timing. `npm run dev:web` uses it via
 * src/platform/bridge.ts; tests pass `{ timeScale: 0 }` to make every delay resolve immediately.
 */
import type { AiwcBridge, InvokeChannel, InvokeReq, InvokeRes } from '@aiwc/protocol'
// eslint-disable-next-line boundaries/element-types -- demo data lives in dev/fixtures and is only loaded in web mode (ARCHITECTURE §3, §11)
import rawFixture from '../../dev/fixtures/demo-dataset.json'
import { createMockContext, type Handlers, type MockOptions } from './mock/core'
import type { DemoFixture } from './mock/types'
import { substrateHandlers } from './mock/substrate'
import { agentHandlers } from './mock/agent'
import { memoryHandlers } from './mock/memory'
import { cloneHandlers } from './mock/clone'
import { autoreplyHandlers } from './mock/autoreply'
import { miscHandlers } from './mock/misc'

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

  // Spreading module objects also copies their helper methods (state, rules, …); pick handlers only.
  const handlers: Handlers = {
    ...pickChannels(substrate),
    ...pickChannels(agent),
    ...pickChannels(memory),
    ...pickChannels(autoreply),
    ...pickChannels(clone),
    ...pickChannels(misc),
  } as Handlers

  return {
    runtime: 'web',
    platform: ctx.platform,
    handlers,
    async invoke<K extends InvokeChannel>(channel: K, req: InvokeReq<K>): Promise<InvokeRes<K>> {
      const handler = handlers[channel] as ((r: InvokeReq<K>) => Promise<InvokeRes<K>> | InvokeRes<K>) | undefined
      if (!handler) throw new Error(`[mockBridge] unknown channel: ${channel}`)
      return await handler(req)
    },
    on: ctx.on,
  }
}

function pickChannels<T extends object>(module: T): Partial<Handlers> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(module)) if (key.includes(':') && typeof value === 'function') out[key] = value
  return out as Partial<Handlers>
}
