/**
 * Thread-level test harness: a Thread wired to the in-memory fakes with an event collector.
 */
import type { ContentPart, ModelClient, ThreadSettings, UserInput } from '@aiwc/protocol'
import type { FragmentProvider } from '../../ports'
import { createEmitter, type Emitter } from '../emitter'
import { Thread } from '../thread'
import type { KernelConfig } from '../types'
import { collectEvents, createTestServices, testOrigin, testSettings, testThreadId, type FakeTool, type TestServices } from './fakes'

export const defaultTestConfig = (patch?: Partial<KernelConfig>): KernelConfig => ({
  maxStepsPerTurn: 40,
  compactionThreshold: 0.8,
  turnTimeoutMs: 60_000,
  defaultPermissionMode: 'bypass',
  allowAlways: [],
  ...patch,
})

export const userInput = (text: string, extra?: Partial<UserInput>): UserInput => ({
  content: [{ type: 'text', text } as ContentPart],
  mentions: [],
  ...extra,
})

export interface ThreadHarness {
  thread: Thread
  services: TestServices
  emitter: Emitter
  events: ReturnType<typeof collectEvents>
  config: KernelConfig
}

export async function createThreadHarness(input: {
  model: ModelClient
  auxiliary?: ModelClient
  tools?: FakeTool[]
  config?: Partial<KernelConfig>
  settings?: Partial<ThreadSettings>
  fragmentProviders?: FragmentProvider[]
  stable?: string
  threadId?: string
  rolloutRewrite?: boolean
}): Promise<ThreadHarness> {
  const services = createTestServices({ model: input.model, auxiliary: input.auxiliary, tools: input.tools, fragmentProviders: input.fragmentProviders, rolloutRewrite: input.rolloutRewrite })
  const emitter = createEmitter()
  const events = collectEvents(emitter.on)
  const config = defaultTestConfig(input.config)
  const threadId = testThreadId(input.threadId)
  const settings = testSettings(input.settings)
  await services.rollout.create({ threadId, origin: testOrigin(), settings })
  const thread = new Thread(
    { services, config: () => config, systemPrompt: { stable: input.stable ?? '你是 AIWC 的本地助手。' }, emit: emitter.emit },
    { threadId, origin: testOrigin(), settings },
  )
  return { thread, services, emitter, events, config }
}
