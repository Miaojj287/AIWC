// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type ProviderConfig } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { DraftStart } from './DraftStart'

function seed(providers: ProviderConfig[]) {
  const base = defaultConfig()
  useConfigStore.setState({ config: { ...base, ai: { ...base.ai, providers } }, hydrated: true, error: undefined })
}

afterEach(() => {
  cleanup()
  __resetConfigStoreForTests()
})

describe('empty thread without a model', () => {
  it('offers to connect a model and opens 设置 › AI 接入', () => {
    seed([])
    const opened = vi.fn()
    const off = onCommand('tab.openSettings', opened)
    render(<DraftStart />)
    fireEvent.click(screen.getByRole('button', { name: '去接入模型' }))
    expect(opened).toHaveBeenCalledWith({ page: 'ai', highlight: 'ai.providers' })
    off()
  })

  it('greets as usual once a model is usable', () => {
    seed([
      {
        id: 'ollama',
        kind: 'ollama',
        label: 'Ollama',
        models: [
          {
            modelId: 'qwen3:8b',
            label: 'qwen3:8b',
            contextWindow: 32_000,
            supportsTools: true,
            supportsVision: false,
            enabled: true,
          },
        ],
      },
    ])
    render(<DraftStart />)
    expect(screen.queryByRole('button', { name: '去接入模型' })).toBeNull()
  })
})
