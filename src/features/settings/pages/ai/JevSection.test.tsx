// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { createMockBridge, type MockBridge } from '@/platform/mockBridge'
import { JevSection } from './JevSection'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let bridge: MockBridge
const secretSet = vi.fn(async () => undefined)
const jevTest = vi.fn(async () => ({ ok: true, latencyMs: 120, models: ['jev-latest'] }))

function mount(configured: boolean) {
  bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['secret:set'] = secretSet
  bridge.handlers['secret:has'] = () => configured
  bridge.handlers['jev:test'] = jevTest
  __setBridgeForTests(bridge)
  const base = bridge.handlers['config:get'] as () => AppConfig
  const config = base()
  const seeded = {
    ...config,
    ai: { ...config.ai, jev: { ...config.ai.jev, apiKeyRef: configured ? 'ai.jev.apiKey' : undefined } },
  }
  useConfigStore.setState({ config: seeded, hydrated: true, error: undefined })
  render(
    <TooltipProvider>
      <JevSection />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
  secretSet.mockClear()
  jevTest.mockClear()
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  vi.unstubAllGlobals()
})

describe('JevSection', () => {
  it('saves a typed key into the secret store and points the config at it', async () => {
    mount(false)
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
    const save = screen.getByRole('button', { name: '保存 Key' })
    expect(save.hasAttribute('disabled') || save.getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-jev-123' } })
    fireEvent.click(screen.getByRole('button', { name: '保存 Key' }))
    await waitFor(() => expect(secretSet).toHaveBeenCalledWith({ ref: 'ai.jev.apiKey', value: 'sk-jev-123' }))
    await waitFor(() => expect(useConfigStore.getState().config?.ai.jev.apiKeyRef).toBe('ai.jev.apiKey'))
  })

  it('tests the connection and remembers the result on the config', async () => {
    mount(true)
    expect(await screen.findByRole('button', { name: '清除' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => expect(jevTest).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(useConfigStore.getState().config?.ai.jev.lastTest).toMatchObject({ ok: true, latencyMs: 120 }),
    )
    expect(await screen.findByText('已连接 · 120 ms')).toBeTruthy()
  })
})
