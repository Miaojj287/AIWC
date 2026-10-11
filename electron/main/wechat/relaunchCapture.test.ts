import { describe, expect, it, vi } from 'vitest'
import type { KeyAcquirePhase } from '@aiwc/protocol'
import { nullLogger } from '../log'
import { createRelaunchCapture, type RelaunchCaptureDeps } from './relaunchCapture'
import type { WeChatControl } from './wechatProcess'

function fakeControl(overrides: Partial<WeChatControl> = {}): WeChatControl {
  return {
    isRunning: vi.fn(() => true),
    quit: vi.fn(async () => true),
    launch: vi.fn(async () => 7),
    ensureRunning: vi.fn(async () => true),
    ...overrides,
  }
}

function setup(overrides: Partial<RelaunchCaptureDeps> = {}) {
  let clock = 0
  const phases: { phase: KeyAcquirePhase; waitUntil?: number }[] = []
  const deps: RelaunchCaptureDeps = {
    control: fakeControl(),
    scanLive: vi.fn(async () => ({})),
    scanDumps: vi.fn(async () => ({})),
    findPid: () => 7,
    logger: nullLogger,
    platform: 'darwin',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    ...overrides,
  }
  const capture = createRelaunchCapture(deps)
  const run = (signal?: AbortSignal) =>
    capture({
      sessionDb: '/db/session.db',
      timeoutMs: 10_000,
      signal,
      onPhase: (phase, waitUntil) => phases.push({ phase, waitUntil }),
    })
  return { deps, phases, run, advance: (ms: number) => (clock += ms) }
}

describe('createRelaunchCapture', () => {
  it('quits, relaunches and reports the login wait with its deadline', async () => {
    const { phases, run } = setup({ scanLive: async () => ({ key: 'k'.repeat(64) }) })
    await expect(run()).resolves.toEqual({ key: 'k'.repeat(64) })
    expect(phases).toEqual([
      { phase: 'closing_wechat', waitUntil: undefined },
      { phase: 'launching_wechat', waitUntil: undefined },
      { phase: 'waiting_relaunch_login', waitUntil: 10_000 },
    ])
  })

  it('times out with a reason and leaves WeChat running', async () => {
    const { deps, run } = setup()
    await expect(run()).resolves.toEqual({ failure: 'relaunch_timeout' })
    expect(deps.control.ensureRunning).toHaveBeenCalled()
  })

  it('brings WeChat back when cancelled mid-wait', async () => {
    const controller = new AbortController()
    const { deps, run } = setup({
      scanLive: async () => {
        controller.abort()
        return {}
      },
    })
    await expect(run(controller.signal)).resolves.toEqual({ failure: 'cancelled' })
    expect(deps.control.ensureRunning).toHaveBeenCalled()
  })

  it('brings WeChat back when a scan throws', async () => {
    const { deps, run } = setup({
      scanLive: async () => {
        throw new Error('helper crashed')
      },
    })
    await expect(run()).resolves.toEqual({ failure: 'relaunch_timeout' })
    expect(deps.control.ensureRunning).toHaveBeenCalled()
  })

  it('says so when WeChat does not come back', async () => {
    const { run } = setup({ control: fakeControl({ launch: async () => undefined }) })
    await expect(run()).resolves.toEqual({ failure: 'wechat_relaunch_failed' })
  })

  it('does nothing outside macOS', async () => {
    const { deps, run } = setup({ platform: 'win32' })
    await expect(run()).resolves.toEqual({})
    expect(deps.control.quit).not.toHaveBeenCalled()
  })
})
