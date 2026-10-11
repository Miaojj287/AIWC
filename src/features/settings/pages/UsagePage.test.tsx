// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type ModelCallDetail } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { createMockBridge, type MockBridge } from '@/platform/mockBridge'
import { UsagePage } from './UsagePage'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let bridge: MockBridge

function mount() {
  const base = defaultConfig()
  useConfigStore.setState({ config: base, hydrated: true, error: undefined })
  bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  __setBridgeForTests(bridge)
  render(
    <TooltipProvider>
      <UsagePage />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
  vi.unstubAllGlobals()
})

describe('用量与记录', () => {
  it('shows totals by feature and model, and the call log', async () => {
    mount()
    expect(await screen.findByText('按功能')).toBeTruthy()
    expect(screen.getByText('按模型')).toBeTruthy()
    expect((await screen.findAllByRole('button', { name: /查看「Agent 对话 · / })).length).toBeGreaterThan(0)
  })

  it('opens a call and says when its content was not recorded', async () => {
    mount()
    const rows = await screen.findAllByRole('button', { name: /查看「/ })
    fireEvent.click(rows[0]!)
    expect(await screen.findByText(/只记了元数据/)).toBeTruthy()
  })

  it('shows recorded content of a call', async () => {
    mount()
    const detail: ModelCallDetail = {
      id: 'x',
      at: Date.now(),
      feature: 'agent',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      local: false,
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 10,
      status: 'ok',
      hasContent: true,
      request: '{"system":"hello"}',
      response: '{"text":"world"}',
    }
    bridge.handlers['models:getCall'] = async () => detail
    const rows = await screen.findAllByRole('button', { name: /查看「/ })
    fireEvent.click(rows[0]!)
    expect(await screen.findByText('{"system":"hello"}')).toBeTruthy()
  })

  it('asks before clearing usage and then shows the empty state', async () => {
    mount()
    await screen.findByText('按功能')
    fireEvent.click(screen.getByRole('button', { name: '清空用量统计' }))
    fireEvent.click(await screen.findByRole('button', { name: '清空' }))
    await waitFor(() => expect(screen.getByText('还没有模型调用')).toBeTruthy())
  })

  it('saves the 记录内容 switch to the config', async () => {
    mount()
    const set = vi.spyOn(useConfigStore.getState(), 'set').mockResolvedValue(defaultConfig())
    fireEvent.click(await screen.findByRole('switch', { name: '记录内容' }))
    await waitFor(() => expect(set).toHaveBeenCalledWith({ ai: { callLog: { recordContent: true } } }))
  })
})
