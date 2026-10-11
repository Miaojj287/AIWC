import { afterEach, describe, expect, it } from 'vitest'
import type { ModelCallDetail } from '@aiwc/protocol'
import { createUsageStore, localDay, type UsageStore } from './usageStore'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 11, 15, 0, 0).getTime()

let store: UsageStore | undefined
afterEach(() => store?.close())

const call = (patch: Partial<ModelCallDetail>): ModelCallDetail => ({
  id: patch.id ?? Math.random().toString(36).slice(2),
  at: NOW,
  feature: 'agent',
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  local: false,
  inputTokens: 100,
  outputTokens: 20,
  latencyMs: 900,
  status: 'ok',
  hasContent: false,
  ...patch,
})

describe('usage.db', () => {
  it('rolls calls up by day, feature and model', () => {
    store = createUsageStore({ file: ':memory:', clock: () => NOW })
    store.record(call({ feature: 'agent' }))
    store.record(call({ feature: 'autoReply', status: 'error', errorCode: 'rate_limit' }))
    store.record(call({ at: NOW - 2 * DAY, modelId: 'qwen-plus', providerId: 'qwen', inputTokens: 1000 }))
    const summary = store.summary(7)
    expect(summary.days).toHaveLength(7)
    expect(summary.days.at(-1)).toMatchObject({ day: localDay(NOW), requests: 2, errors: 1, inputTokens: 200 })
    expect(summary.totals).toMatchObject({ requests: 3, inputTokens: 1200, outputTokens: 60 })
    expect(summary.byFeature.map((f) => f.feature)).toEqual(['agent', 'autoReply'])
    expect(summary.byModel[0]).toMatchObject({ modelId: 'qwen-plus', requests: 1 })
    expect(store.summary(1).totals.requests).toBe(2)
  })

  it('pages the call log newest first and keeps content only where recorded', () => {
    store = createUsageStore({ file: ':memory:', clock: () => NOW })
    store.record(call({ id: 'a', at: NOW - 3000 }))
    store.record(
      call({ id: 'b', at: NOW - 2000, request: '{"system":"x"}', response: '{"text":"y"}', hasContent: true }),
    )
    store.record(call({ id: 'c', at: NOW - 1000, feature: 'title' }))
    const first = store.listCalls({ limit: 2 })
    expect(first.items.map((c) => c.id)).toEqual(['c', 'b'])
    expect(first.hasMore).toBe(true)
    const last = first.items.at(-1)!
    expect(store.listCalls({ limit: 2, before: { at: last.at, id: last.id } }).items.map((c) => c.id)).toEqual(['a'])
    expect(store.listCalls({ limit: 5, feature: 'title' }).items.map((c) => c.id)).toEqual(['c'])
    expect(store.getCall('b')).toMatchObject({ hasContent: true, request: '{"system":"x"}' })
    store.dropContent()
    expect(store.getCall('b')).toMatchObject({ hasContent: false, request: undefined })
  })

  it('clears the log alone, or the log and the roll-ups', () => {
    store = createUsageStore({ file: ':memory:', clock: () => NOW })
    store.record(call({}))
    store.clearCalls()
    expect(store.listCalls({ limit: 10 }).items).toEqual([])
    expect(store.summary(7).totals.requests).toBe(1)
    store.clearUsage()
    expect(store.summary(7).totals.requests).toBe(0)
  })

  it('drops call-log rows older than the retention window', () => {
    let now = NOW
    store = createUsageStore({ file: ':memory:', clock: () => now })
    store.record(call({ id: 'old', at: NOW - 40 * DAY }))
    for (let i = 0; i < 60; i++) store.record(call({ at: NOW }))
    now = NOW
    expect(store.getCall('old')).toBeNull()
    // Roll-ups outlive the call log.
    expect(store.summary(90).totals.requests).toBe(61)
  })
})
