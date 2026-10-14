// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge, type AppConfig, type ConfigPatch } from '@aiwc/protocol'
import { clearToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests } from '@/platform/configStore'
import { App } from './App'
import { runCommand } from './commands'

// Only App's own wiring is under test: the wizard is a button that finishes (labelled by mode), the splash ends as
// soon as the app is ready, the Shell is a landmark.
vi.mock('@/features/onboarding', () => ({
  OnboardingWizard: ({ onDone, returning }: { onDone(): void; returning?: boolean }) => (
    <button type="button" onClick={onDone}>
      {returning ? '进入' : '完成向导'}
    </button>
  ),
  LaunchSplash: function LaunchSplash({ ready, onFinished }: { ready: boolean; onFinished(): void }) {
    useEffect(() => {
      if (ready) onFinished()
    }, [ready, onFinished])
    return null
  },
}))
vi.mock('@/shell/Shell', () => ({ Shell: () => <main>工作台</main> }))
vi.mock('@/features/agent', () => ({ AgentWindow: () => <main>Agent 窗口</main> }))
vi.mock('./registerFeatures', () => ({ registerFeatures: () => {} }))

let failingWrites: number
let writes: ConfigPatch[]
let initialConfig: AppConfig
let hasCachedConnection: boolean
let connectionFails: boolean
let connectionCalls: string[]

function fakeBridge(): AiwcBridge {
  let current: AppConfig = initialConfig
  return {
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string, req: unknown) => {
      if (channel === 'config:get') return current
      if (channel === 'substrate:credentialStatus') {
        connectionCalls.push(channel)
        return {
          database: hasCachedConnection,
          imageXor: false,
          imageAes: false,
          matched: hasCachedConnection ? 1 : 0,
          total: 1,
          missing: [],
          revision: 1,
        }
      }
      if (channel === 'substrate:connect') {
        connectionCalls.push(channel)
        return { ok: !connectionFails }
      }
      if (channel === 'config:set') {
        const patch = req as ConfigPatch
        writes.push(patch)
        if (failingWrites > 0) {
          failingWrites--
          throw new Error('磁盘已满')
        }
        current = {
          ...current,
          onboarding: { ...current.onboarding, ...patch.onboarding },
          ui: { ...current.ui, ...patch.ui },
        }
        return current
      }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
}

const flush = () => act(async () => {})

beforeEach(() => {
  failingWrites = 0
  writes = []
  initialConfig = defaultConfig()
  hasCachedConnection = false
  connectionFails = false
  connectionCalls = []
  __resetConfigStoreForTests()
  __setBridgeForTests(fakeBridge())
})
afterEach(() => {
  cleanup()
  clearToasts()
  __setBridgeForTests(undefined)
})

describe('App onboarding', () => {
  it('opens the Shell once finishing the wizard is saved', async () => {
    render(<App />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '完成向导' }))
    await flush()
    expect(screen.getByRole('main').textContent).toBe('工作台')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(writes).toEqual([{ onboarding: { completed: true } }])
  })

  it('reports a failed save with a retry instead of silently returning to the wizard', async () => {
    failingWrites = 1
    render(<App />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '完成向导' }))
    await flush()

    // the optimistic Shell rolled back to the wizard, and the user is told why
    expect(screen.getByRole('button', { name: '完成向导' })).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('无法完成设置')
    expect(alert.textContent).toContain('磁盘已满')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await flush()
    expect(screen.getByRole('main').textContent).toBe('工作台')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(writes).toHaveLength(2)
  })
})

describe('App later launches', () => {
  it('automatically opens the saved account without scanning or another confirmation click', async () => {
    initialConfig = {
      ...defaultConfig(),
      onboarding: { completed: true },
      account: { ...defaultConfig().account, wxid: 'saved', dbRoot: '/saved' },
    }
    hasCachedConnection = true
    __setBridgeForTests(fakeBridge())
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await flush()
    expect(screen.getByRole('main').textContent).toBe('工作台')
    expect(screen.queryByRole('button', { name: '进入' })).toBeNull()
    expect(connectionCalls).toEqual(['substrate:credentialStatus', 'substrate:connect'])
    expect(writes).toEqual([])
  })

  it('keeps the connection page after a failed cached connection and does not retry on rerender', async () => {
    initialConfig = {
      ...defaultConfig(),
      onboarding: { completed: true },
      account: { ...defaultConfig().account, wxid: 'saved', dbRoot: '/saved' },
    }
    hasCachedConnection = true
    connectionFails = true
    __setBridgeForTests(fakeBridge())
    const view = render(<App />)
    await flush()
    expect(screen.queryByRole('main')).toBeNull()
    expect(screen.getByRole('button', { name: '进入' })).toBeTruthy()
    view.rerender(<App />)
    await flush()
    expect(connectionCalls).toEqual(['substrate:credentialStatus', 'substrate:connect'])
  })

  it('stops on the connect page first and opens the Shell only after 进入, without writing config', async () => {
    initialConfig = { ...defaultConfig(), onboarding: { completed: true } }
    __setBridgeForTests(fakeBridge())
    render(<App />)
    await flush()
    expect(screen.queryByRole('main')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '进入' }))
    await flush()
    expect(screen.getByRole('main').textContent).toBe('工作台')
    expect(writes).toEqual([])
  })
})

describe('App layout (CLAUDE.md §12)', () => {
  it('renders the Agent window for ui.shellMode = agent and returns to the workbench on shell.toggleMode', async () => {
    const base = defaultConfig()
    initialConfig = { ...base, onboarding: { completed: true }, ui: { ...base.ui, shellMode: 'agent' } }
    __setBridgeForTests(fakeBridge())
    render(<App />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '进入' }))
    await flush()
    expect(screen.getByRole('main').textContent).toBe('Agent 窗口')

    act(() => runCommand('shell.toggleMode'))
    await flush()
    expect(screen.getByRole('main').textContent).toBe('工作台')
    expect(writes).toEqual([{ ui: { shellMode: 'workbench' } }])
  })
})
