// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type ProviderConfig } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { ModelSetupStep } from './ModelSetupStep'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>() }))
vi.mock('@/platform/hooks', () => ({ invoke: invokeMock }))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mount(providers: ProviderConfig[]) {
  const base = defaultConfig()
  useConfigStore.setState({ config: { ...base, ai: { ...base.ai, providers } }, hydrated: true, error: undefined })
  const onFinish = vi.fn()
  render(
    <TooltipProvider>
      <ModelSetupStep onBack={() => {}} onFinish={onFinish} stepsBar={null} />
    </TooltipProvider>,
  )
  return { onFinish }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  __resetConfigStoreForTests()
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(false)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('首次引导 › 接入模型', () => {
  it('can be skipped, saying what waits for a model', () => {
    const { onFinish } = mount([])
    expect(screen.getByText(/随时可在「设置 › AI 接入」配置/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '稍后再说' }))
    expect(onFinish).toHaveBeenCalled()
  })

  it('lists online vendors and the local Ollama, each opening the connect dialog', async () => {
    mount([])
    expect(screen.getByRole('button', { name: /DeepSeek/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ollama/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('finishes with the primary button once a model is usable', () => {
    const { onFinish } = mount([
      {
        id: 'deepseek',
        vendor: 'deepseek',
        kind: 'openai-compatible',
        label: 'DeepSeek',
        models: [
          {
            modelId: 'deepseek-chat',
            label: 'deepseek-chat',
            contextWindow: 128_000,
            supportsTools: true,
            supportsVision: false,
            enabled: true,
          },
        ],
      },
    ])
    expect(screen.getByText('已接入')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onFinish).toHaveBeenCalled()
  })
})
