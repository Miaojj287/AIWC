/**
 * One way to run a vendor CLI: argv only (never a shell), bounded output, and a kill that reaches the
 * whole process group — the npm shims (`lark-cli` → scripts/run.js → Go binary) fork the real binary,
 * so killing only the shim would leave a device-flow poller running in the background.
 */
import { spawn, type ChildProcess } from 'node:child_process'

export interface RunOptions {
  env: NodeJS.ProcessEnv
  cwd?: string
  /** Hard wall clock; the group is killed when it elapses. */
  timeoutMs?: number
  signal?: AbortSignal
  /** Written to stdin, then stdin is closed. Without it stdin is closed immediately (no TTY prompts). */
  input?: string
  /** Streaming view of stdout / stderr (ANSI stripped), e.g. to catch an auth URL before exit. */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void
  maxOutputChars?: number
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** spawn itself failed (ENOENT, EACCES…). */
  spawnError?: string
}

const DEFAULT_MAX_OUTPUT = 4_000_000
const KILL_GRACE_MS = 1500

const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:|\\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** Processes started here that are still alive; killed on app shutdown. */
const live = new Set<ChildProcess>()

export function killAllCliProcesses(): void {
  for (const child of [...live]) killGroup(child, 'SIGKILL')
}

export function runProcess(command: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  const max = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true })
      return
    }
    let child: ChildProcess
    try {
      child = spawn(command, [...args], {
        env: opts.env,
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group on POSIX so the kill below reaches forked children too.
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch (e) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnError: e instanceof Error ? e.message : String(e),
      })
      return
    }
    live.add(child)

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    const append = (current: string, chunk: string): string =>
      current.length >= max ? current : (current + chunk).slice(0, max)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (raw: string) => {
      const chunk = stripAnsi(raw)
      stdout = append(stdout, chunk)
      opts.onOutput?.(chunk, 'stdout')
    })
    child.stderr?.on('data', (raw: string) => {
      const chunk = stripAnsi(raw)
      stderr = append(stderr, chunk)
      opts.onOutput?.(chunk, 'stderr')
    })

    const stop = () => {
      killGroup(child, 'SIGTERM')
      graceTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          stop()
        }, opts.timeoutMs)
      : undefined
    const onAbort = () => {
      aborted = true
      stop()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null, spawnError?: string) => {
      if (settled) return
      settled = true
      live.delete(child)
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut, aborted, spawnError })
    }
    child.on('error', (e) => finish(null, e.message))
    child.on('close', (code) => finish(code))

    child.stdin?.on('error', () => {
      /* the CLI may exit before reading stdin */
    })
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

function killGroup(child: ChildProcess, sig: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
        'error',
        () => {},
      )
    } else {
      process.kill(-child.pid, sig)
    }
  } catch {
    try {
      child.kill(sig)
    } catch {
      /* already gone */
    }
  }
}
