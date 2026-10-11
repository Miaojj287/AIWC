/**
 * Quit / start the macOS WeChat app for key capture. Quitting waits until the process is really gone
 * (escalating to SIGKILL) before starting it again: `open` against an app that is still shutting down
 * only re-activates the dying instance, which then exits and leaves WeChat closed. Launching goes by
 * bundle id (works for both WeChat.app and Weixin.app) and is confirmed by the main process appearing.
 */
import { execFile } from 'node:child_process'
import { findWeChatPidSync } from '@aiwc/substrate'

/** Bundle id shared by WeChat.app and Weixin.app (also the sandbox container name). */
const WECHAT_BUNDLE_ID = 'com.tencent.xinWeChat'
/** Graceful quit budget before SIGKILL. */
const QUIT_WAIT_MS = 8_000
/** Budget after SIGKILL. */
const FORCE_QUIT_WAIT_MS = 4_000
/** How long a launched WeChat gets to show its main process. */
const LAUNCH_WAIT_MS = 20_000
const POLL_MS = 250
const OPEN_TIMEOUT_MS = 10_000

export interface WeChatProcessDeps {
  findPid(): number | null
  kill(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void
  /** Run `/usr/bin/open` with args; rejects on a non-zero exit. */
  open(args: string[]): Promise<void>
  sleep(ms: number): Promise<void>
  now(): number
}

export interface WeChatControl {
  isRunning(): boolean
  /** Quit WeChat; true once no main process is left. */
  quit(): Promise<boolean>
  /** Start WeChat and wait for its main process (one retry). Returns the pid, or undefined. */
  launch(): Promise<number | undefined>
  /** Start WeChat only when it is not running. True when it is running afterwards. */
  ensureRunning(): Promise<boolean>
}

function defaultDeps(): WeChatProcessDeps {
  return {
    findPid: findWeChatPidSync,
    kill: (pid, signal) => process.kill(pid, signal),
    open: (args) =>
      new Promise((resolve, reject) => {
        execFile('/usr/bin/open', args, { timeout: OPEN_TIMEOUT_MS }, (error) => (error ? reject(error) : resolve()))
      }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  }
}

export function createWeChatControl(overrides: Partial<WeChatProcessDeps> = {}): WeChatControl {
  const deps = { ...defaultDeps(), ...overrides }

  const waitFor = async (ready: () => boolean, budgetMs: number): Promise<boolean> => {
    const deadline = deps.now() + budgetMs
    while (!ready()) {
      if (deps.now() >= deadline) return false
      await deps.sleep(POLL_MS)
    }
    return true
  }

  const signalAll = (signal: 'SIGTERM' | 'SIGKILL') => {
    const pid = deps.findPid()
    if (!pid) return
    try {
      deps.kill(pid, signal)
    } catch {
      // Already exited between the lookup and the signal — that is the goal anyway.
    }
  }

  const startOnce = async (): Promise<number | undefined> => {
    // Bundle id first; the app names are fallbacks for installs LaunchServices has not indexed.
    for (const args of [
      ['-b', WECHAT_BUNDLE_ID],
      ['-a', 'WeChat'],
      ['-a', 'Weixin'],
    ]) {
      try {
        await deps.open(args)
        break
      } catch {
        // try the next way of naming the app
      }
    }
    let pid: number | undefined
    await waitFor(() => (pid = deps.findPid() ?? undefined) !== undefined, LAUNCH_WAIT_MS)
    return pid
  }

  const launch = async () => (await startOnce()) ?? (await startOnce())

  return {
    isRunning: () => deps.findPid() !== null,
    async quit() {
      if (deps.findPid() === null) return true
      signalAll('SIGTERM')
      if (await waitFor(() => deps.findPid() === null, QUIT_WAIT_MS)) return true
      signalAll('SIGKILL')
      return waitFor(() => deps.findPid() === null, FORCE_QUIT_WAIT_MS)
    },
    launch,
    async ensureRunning() {
      if (deps.findPid() !== null) return true
      return (await launch()) !== undefined
    },
  }
}
