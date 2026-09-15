/**
 * A vendor CLI bound to its resolved executable, plus the success rules the three CLIs share:
 * exit 0, and no error envelope (`ok:false` lark-cli, `success:false` dws, `errcode≠0` / `error` wecom-cli).
 */
import type { OfficeErrorCode } from '@aiwc/protocol'
import { resolveCommand, runProcess, type CliEnv, type NodeRuntime, type RunResult } from '@aiwc/shell'
import { cliErrorMessage, parseJsonOutput } from './output'

export class OfficeError extends Error {
  constructor(
    readonly code: OfficeErrorCode,
    message: string,
    /** A command the user could run in a terminal to get unstuck. */
    readonly command?: string,
  ) {
    super(message)
    this.name = 'OfficeError'
  }
}

export interface CliRunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  input?: string
  cwd?: string
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** Merged over the CLI environment for this run only (undefined unsets a variable). */
  env?: NodeJS.ProcessEnv
}

export interface CliRunner {
  /** Binary name, e.g. `lark-cli`. */
  readonly name: string
  /** Absolute path of the executable that was found. */
  readonly path: string
  run(args: readonly string[], opts?: CliRunOptions): Promise<RunResult>
  /** run() that must succeed; returns the parsed JSON document (undefined when the CLI printed none). */
  json(args: readonly string[], opts?: CliRunOptions): Promise<unknown>
}

export const DEFAULT_CLI_TIMEOUT_MS = 90_000

export async function createCliRunner(
  name: string,
  path: string,
  cliEnv: CliEnv,
  fallbackNode?: NodeRuntime,
): Promise<CliRunner> {
  const resolved = await resolveCommand(path, cliEnv, fallbackNode)
  const env = resolved.env ? { ...cliEnv.env, ...resolved.env } : cliEnv.env
  const run: CliRunner['run'] = (args, opts = {}) =>
    runProcess(resolved.command, [...resolved.prefixArgs, ...args], {
      env: opts.env ? { ...env, ...opts.env } : env,
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
      signal: opts.signal,
      input: opts.input,
      onOutput: opts.onOutput,
    })
  return {
    name,
    path,
    run,
    async json(args, opts) {
      const result = await run(args, opts)
      assertOk(name, args, result)
      return parseJsonOutput(result.stdout)
    },
  }
}

/** Throws the OfficeError a failed run deserves; returns when the run succeeded. */
export function assertOk(name: string, args: readonly string[], result: RunResult): void {
  if (result.aborted) throw new OfficeError('cancelled', '已取消')
  if (result.timedOut) throw new OfficeError('timeout', `${name} ${args.slice(0, 2).join(' ')} 执行超时`)
  if (result.spawnError) throw new OfficeError('cli_missing', `无法启动 ${name}：${result.spawnError}`)
  const json = parseJsonOutput(result.stdout)
  if (result.code !== 0 || envelopeFailed(json))
    throw new OfficeError('cli_error', cliErrorMessage(result.stdout, result.stderr))
}

export function envelopeFailed(json: unknown): boolean {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false
  const r = json as Record<string, unknown>
  if (r.ok === false || r.success === false) return true
  if (typeof r.errcode === 'number' && r.errcode !== 0) return true
  return r.error !== undefined && r.error !== null && r.ok !== true
}

/** `name version 1.2.3` / `v1.2.3` / `1.2.3 (…)` → `1.2.3`. */
export function parseVersion(text: string): string | undefined {
  return /v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/.exec(text)?.[1]
}
