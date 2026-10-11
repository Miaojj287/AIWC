import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../contracts'
import { createUsageStore } from '../ai/usageStore'
import { createHandlerHarness } from './testing/handlerHarness'
import type { HostBridge } from './register'
import { registerModelsIpc } from './models'

function setup() {
  const usage = createUsageStore({ file: ':memory:' })
  const testProxy = vi.fn(async () => ({ ok: true, route: 'direct' as const }))
  // Only modelOps is read by these handlers; the rest of AppContext is irrelevant here.
  const ctx = { modelOps: { usage, testProxy } } as unknown as AppContext
  const harness = createHandlerHarness()
  registerModelsIpc(ctx, {} as HostBridge, harness.handle)
  return { harness, testProxy, usage }
}

describe('models IPC validation', () => {
  it('rejects out-of-range or malformed requests from the renderer', () => {
    const { harness } = setup()
    expect(() => harness.invokeRaw('models:usageSummary', { days: 0 })).toThrow()
    expect(() => harness.invokeRaw('models:listCalls', { limit: 10, feature: 'nope' })).toThrow()
    expect(() => harness.invokeRaw('models:getCall', { id: '' })).toThrow()
  })

  it('only probes plain http(s) addresses without credentials', async () => {
    const { harness, testProxy } = setup()
    expect(() => harness.invokeRaw('models:testProxy', { url: 'file:///etc/passwd' })).toThrow()
    expect(() => harness.invokeRaw('models:testProxy', { url: 'https://u:p@example.com' })).toThrow()
    await harness.invoke('models:testProxy', { url: 'https://api.deepseek.com' })
    await harness.invoke('models:testProxy', {})
    expect(testProxy).toHaveBeenCalledWith('https://api.deepseek.com')
    expect(testProxy).toHaveBeenCalledWith(undefined)
  })

  it('answers summaries and pages from usage.db', () => {
    const { harness, usage } = setup()
    expect(harness.invoke('models:usageSummary', { days: 7 })).toMatchObject({ totals: { requests: 0 } })
    expect(harness.invoke('models:listCalls', { limit: 20 })).toEqual({ items: [], hasMore: false })
    usage.close()
  })
})
