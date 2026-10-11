import { describe, expect, it, vi } from 'vitest'
import { createWeChatControl, type WeChatProcessDeps } from './wechatProcess'

/** A fake WeChat: `pid` is the running process (null = not running). */
function fakeWeChat(initial: number | null) {
  let clock = 0
  const state = { pid: initial, exitsOn: 'SIGTERM' as 'SIGTERM' | 'SIGKILL' | 'never', launchesAfterMs: 500 }
  let launchAt: number | undefined
  const deps: WeChatProcessDeps = {
    findPid: () => {
      if (state.pid === null && launchAt !== undefined && clock >= launchAt) {
        state.pid = 99
        launchAt = undefined
      }
      return state.pid
    },
    kill: vi.fn((_pid: number, signal: 'SIGTERM' | 'SIGKILL') => {
      if (state.exitsOn === signal || (state.exitsOn === 'SIGTERM' && signal === 'SIGKILL')) state.pid = null
    }),
    open: vi.fn(async () => {
      // `open` against a still-running app only activates it — no new process.
      if (state.pid === null && state.launchesAfterMs >= 0) launchAt = clock + state.launchesAfterMs
    }),
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
  }
  return { deps, state }
}

describe('createWeChatControl', () => {
  it('escalates to SIGKILL when WeChat ignores SIGTERM, and only reports quit once it is gone', async () => {
    const { deps, state } = fakeWeChat(42)
    state.exitsOn = 'SIGKILL'
    const control = createWeChatControl(deps)
    await expect(control.quit()).resolves.toBe(true)
    expect(deps.kill).toHaveBeenCalledWith(42, 'SIGTERM')
    expect(deps.kill).toHaveBeenCalledWith(42, 'SIGKILL')
    expect(control.isRunning()).toBe(false)
  })

  it('reports a quit that did not happen', async () => {
    const { deps, state } = fakeWeChat(42)
    state.exitsOn = 'never'
    await expect(createWeChatControl(deps).quit()).resolves.toBe(false)
  })

  it('launches by bundle id and waits for the main process', async () => {
    const { deps } = fakeWeChat(null)
    const control = createWeChatControl(deps)
    await expect(control.launch()).resolves.toBe(99)
    expect(deps.open).toHaveBeenCalledWith(['-b', 'com.tencent.xinWeChat'])
  })

  it('falls back to the app name when the bundle id is unknown to LaunchServices', async () => {
    const { deps } = fakeWeChat(null)
    const open = deps.open
    deps.open = vi.fn(async (args: string[]) => {
      if (args[0] === '-b') throw new Error('unable to find application')
      await open(args)
    })
    await expect(createWeChatControl(deps).launch()).resolves.toBe(99)
    expect(deps.open).toHaveBeenCalledWith(['-a', 'WeChat'])
  })

  it('gives up after a retry when WeChat never appears', async () => {
    const { deps, state } = fakeWeChat(null)
    state.launchesAfterMs = -1
    await expect(createWeChatControl(deps).launch()).resolves.toBeUndefined()
    expect(deps.open).toHaveBeenCalledTimes(2)
  })

  it('ensureRunning leaves a running WeChat alone', async () => {
    const { deps } = fakeWeChat(42)
    await expect(createWeChatControl(deps).ensureRunning()).resolves.toBe(true)
    expect(deps.open).not.toHaveBeenCalled()
  })
})
