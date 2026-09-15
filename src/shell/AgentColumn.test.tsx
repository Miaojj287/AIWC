// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { AgentColumn } from './AgentColumn'
import { __resetShellStoreForTests } from './shellStore'

// The Agent panel and the pet are features with their own tests; here they only need to be able to throw.
const broken = vi.hoisted(() => ({ panel: false, pet: false }))
vi.mock('@/features/agent', () => ({
  AgentPanel: () => {
    if (broken.panel) throw new Error('panel failed')
    return <p>Agent 对话</p>
  },
  useAgentPetSignal: () => undefined,
}))
vi.mock('@/features/pets', () => ({
  AgentPet: () => {
    if (broken.pet) throw new Error('pet failed')
    return <span>宠物</span>
  },
  openPetSettings: () => {},
  useCurrentPet: () => ({ id: 'bundled' }),
}))

const bridge: AiwcBridge = {
  runtime: 'web',
  platform: 'darwin',
  on: () => () => {},
  invoke: (async (channel: string) => {
    throw new Error(`unexpected ${channel}`)
  }) as AiwcBridge['invoke'],
}

const mount = (collapsed: boolean) =>
  render(
    <TooltipProvider>
      <AgentColumn collapsed={collapsed} width={360} onToggleCollapsed={() => {}} mac />
    </TooltipProvider>,
  )

beforeEach(() => {
  broken.panel = false
  broken.pet = false
  __resetShellStoreForTests()
  __resetConfigStoreForTests()
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  __setBridgeForTests(bridge)
  // React reports caught render errors on console.error.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.restoreAllMocks()
})

describe('AgentColumn', () => {
  it('shows the error state inside the panel when the Agent panel fails to render, and retries it', async () => {
    broken.panel = true
    mount(false)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('无法显示此内容')

    broken.panel = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('Agent 对话')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops a crashed pet from the collapsed strip but keeps the expand button', async () => {
    broken.pet = true
    mount(true)
    await act(async () => {})
    expect(screen.getByRole('button', { name: '展开 Agent 面板' })).toBeTruthy()
    expect(screen.queryByText('宠物')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
