import { describe, expect, it, vi } from 'vitest'
import { createSystemNotifier, NOTICE_DEDUPE_MS, shouldNotify, type ShowRequest } from './systemNotifier'

function setup(opts: { focused?: boolean; enabled?: boolean; supported?: boolean } = {}) {
  let now = 1_000
  const shown: ShowRequest[] = []
  const closed = vi.fn()
  const deps = {
    isSupported: () => opts.supported ?? true,
    isAppFocused: vi.fn(() => opts.focused ?? false),
    enabled: () => opts.enabled ?? true,
    show: vi.fn((r: ShowRequest) => {
      shown.push(r)
      return { close: closed }
    }),
    reveal: vi.fn(),
    runCommand: vi.fn(),
    now: () => now,
  }
  const notifier = createSystemNotifier(deps)
  return { notifier, deps, shown, closed, advance: (ms: number) => (now += ms) }
}

describe('shouldNotify', () => {
  it('only for an enabled, supported, unfocused app, once per key in the dedupe window', () => {
    const base = { enabled: true, supported: true, focused: false, lastShownAt: undefined, now: 10_000 }
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, focused: true })).toBe(false)
    expect(shouldNotify({ ...base, enabled: false })).toBe(false)
    expect(shouldNotify({ ...base, supported: false })).toBe(false)
    expect(shouldNotify({ ...base, lastShownAt: 10_000 - NOTICE_DEDUPE_MS + 1 })).toBe(false)
    expect(shouldNotify({ ...base, lastShownAt: 10_000 - NOTICE_DEDUPE_MS })).toBe(true)
  })
})

describe('createSystemNotifier', () => {
  it('shows a background notice and, on click, brings the window back before running its command', () => {
    const { notifier, deps, shown } = setup()
    notifier.notify({
      key: 'approval:1',
      title: 'Agent 需要你确认',
      body: '有一个操作在等你确认',
      action: { command: 'agent.openThread', payload: { threadId: 'thr_1' } },
    })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'Agent 需要你确认', body: '有一个操作在等你确认' })
    shown[0]?.onClick()
    expect(deps.reveal).toHaveBeenCalledTimes(1)
    expect(deps.runCommand).toHaveBeenCalledWith('agent.openThread', { threadId: 'thr_1' })
    expect(deps.reveal.mock.invocationCallOrder[0]).toBeLessThan(deps.runCommand.mock.invocationCallOrder[0] ?? 0)
  })

  it('stays quiet while the app is focused or the setting is off', () => {
    expect(setupAndNotify({ focused: true })).toBe(0)
    expect(setupAndNotify({ enabled: false })).toBe(0)
    expect(setupAndNotify({ supported: false })).toBe(0)
  })

  it('shows one notice per key in the dedupe window', () => {
    const { notifier, shown, advance } = setup()
    notifier.notify({ key: 'reply-draft:g1', title: 'a' })
    notifier.notify({ key: 'reply-draft:g1', title: 'a' })
    notifier.notify({ key: 'reply-draft:g2', title: 'b' })
    expect(shown.map((s) => s.title)).toEqual(['a', 'b'])
    advance(NOTICE_DEDUPE_MS)
    notifier.notify({ key: 'reply-draft:g1', title: 'a' })
    expect(shown).toHaveLength(3)
  })

  it('closes what is still on screen when disposed, and survives a failing OS call', () => {
    const { notifier, closed, deps } = setup()
    notifier.notify({ key: 'x', title: 'x' })
    notifier.dispose()
    expect(closed).toHaveBeenCalledTimes(1)
    deps.show.mockImplementationOnce(() => {
      throw new Error('no notification center')
    })
    expect(() => notifier.notify({ key: 'y', title: 'y' })).not.toThrow()
  })
})

function setupAndNotify(opts: { focused?: boolean; enabled?: boolean; supported?: boolean }): number {
  const { notifier, shown } = setup(opts)
  notifier.notify({ key: 'k', title: 't' })
  return shown.length
}
