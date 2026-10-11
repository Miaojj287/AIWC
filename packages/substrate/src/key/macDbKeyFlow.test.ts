import { describe, expect, it, vi } from 'vitest'
import type { KeyAcquirePhase } from '@aiwc/protocol'
import { runMacDbKeyFlow, type MacDbKeyDeps, type MacDbKeyInput } from './macDbKeyFlow'

const KEY = 'a'.repeat(64)

function setup(overrides: Partial<MacDbKeyDeps> = {}, input: Partial<MacDbKeyInput> = {}) {
  const phases: { phase: KeyAcquirePhase; waitUntil?: number }[] = []
  const deps: MacDbKeyDeps = {
    findPid: () => 4242,
    scanLive: vi.fn(async () => ({})),
    scanDumps: vi.fn(async () => ({})),
    isSipEnabled: vi.fn(async () => false),
    captureHook: vi.fn(async () => ({ code: 'HOOK_FAILED', error: 'hook timeout' })),
    relaunchCapture: vi.fn(async () => ({ failure: 'relaunch_timeout' as const })),
    ...overrides,
  }
  const run = () =>
    runMacDbKeyFlow(deps, {
      sessionDb: '/db/session.db',
      strategy: 'auto',
      scanTimeoutMs: 1_000,
      hookTimeoutMs: 120_000,
      relaunchTimeoutMs: 120_000,
      onPhase: (phase, waitUntil) => phases.push({ phase, waitUntil }),
      ...input,
    })
  return { deps, phases, run }
}

describe('runMacDbKeyFlow', () => {
  it('reports each stage as its own phase, including the login deadline', async () => {
    const { phases, run } = setup({
      captureHook: async (_pid, options) => {
        options.onArmed?.(1_234)
        return { key: KEY }
      },
    })
    await expect(run()).resolves.toMatchObject({ key: KEY })
    expect(phases).toEqual([
      { phase: 'reading_memory', waitUntil: undefined },
      { phase: 'reading_dumps', waitUntil: undefined },
      { phase: 'arming_hook', waitUntil: undefined },
      { phase: 'waiting_login', waitUntil: 1_234 },
    ])
  })

  it('names the login-hook timeout instead of a generic "not found" when the relaunch also misses', async () => {
    const { run } = setup()
    const outcome = await run()
    expect(outcome.key).toBeUndefined()
    expect(outcome.failure).toBe('login_timeout')
    expect(outcome.detail).toBe('hook timeout')
  })

  it('reports that WeChat quit while the hook waited', async () => {
    const { run } = setup({ captureHook: async () => ({ code: 'PROCESS_EXITED' }) })
    await expect(run()).resolves.toMatchObject({ failure: 'wechat_exited' })
  })

  it('does not restart WeChat when the OS denied access to its memory', async () => {
    const { deps, run } = setup({ scanLive: async () => ({ needsAuthorization: true }) })
    await expect(run()).resolves.toMatchObject({ failure: 'needs_authorization' })
    expect(deps.captureHook).not.toHaveBeenCalled()
    expect(deps.relaunchCapture).not.toHaveBeenCalled()
  })

  it('still tries the relaunch when SIP blocks the hook, then explains SIP', async () => {
    const { deps, run } = setup({ isSipEnabled: async () => true })
    await expect(run()).resolves.toMatchObject({ failure: 'sip_enabled' })
    expect(deps.captureHook).not.toHaveBeenCalled()
    expect(deps.relaunchCapture).toHaveBeenCalledTimes(1)
  })

  it('puts a failed WeChat restart first — the user has to reopen it', async () => {
    const { run } = setup({ relaunchCapture: async () => ({ failure: 'wechat_relaunch_failed' }) })
    await expect(run()).resolves.toMatchObject({ failure: 'wechat_relaunch_failed' })
  })

  it('memory_scan never hooks or restarts WeChat', async () => {
    const { deps, run } = setup({}, { strategy: 'memory_scan' })
    await expect(run()).resolves.toMatchObject({ failure: 'not_found' })
    expect(deps.captureHook).not.toHaveBeenCalled()
    expect(deps.relaunchCapture).not.toHaveBeenCalled()
  })

  it('launches WeChat through the relaunch capture when it is not running', async () => {
    const { deps, phases, run } = setup({
      findPid: () => null,
      relaunchCapture: async ({ onPhase }) => {
        onPhase('launching_wechat')
        return { key: KEY }
      },
    })
    await expect(run()).resolves.toMatchObject({ key: KEY })
    expect(deps.scanLive).not.toHaveBeenCalled()
    expect(phases.map((p) => p.phase)).toEqual(['reading_dumps', 'launching_wechat'])
  })

  it('stops between stages once aborted', async () => {
    const controller = new AbortController()
    const { deps, run } = setup(
      {
        scanDumps: async () => {
          controller.abort()
          return {}
        },
      },
      { signal: controller.signal },
    )
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.captureHook).not.toHaveBeenCalled()
    expect(deps.relaunchCapture).not.toHaveBeenCalled()
  })
})
