/**
 * User command hooks on the kernel's HookRunner (the same runner as the host hooks in ../hooks.ts — one hook system):
 * each enabled hook whose event (and tool matcher) applies runs its command in the user's login shell from the AIWC
 * workspace, inside the shell tool's sandbox when the OS has one and the hook asks for it, with the event JSON on
 * stdin and a hard timeout. Hooks run in their configured order; the first block wins and stops the rest.
 *
 * SessionStart has no kernel event of its own: a thread the kernel reports as created runs its SessionStart hooks
 * right before its first UserPromptSubmit, and their context goes into that first turn.
 */
import { tmpdir } from 'node:os'
import {
  compileHookMatcher,
  TOOL_HOOK_EVENTS,
  type ThreadId,
  type UserHookConfig,
  type UserHookEvent,
  type UserHookRunSummary,
  type UserHookTestResult,
} from '@aiwc/protocol'
import type { Hook, HookEventName, HookPayload, HookResult } from '@aiwc/kernel'
import { runProcess, shellCommandFor, type CliEnv, type Sandbox } from '@aiwc/shell'
import type { Logger } from '../log'
import { hookInput, interpretHookResult, type HookDecision, type HookExecution } from './hookProtocol'

const MAX_HOOK_OUTPUT_CHARS = 200_000
const TEST_OUTPUT_CHARS = 4_000
/** Threads waiting for their SessionStart; bounded so threads that never get a prompt cannot pile up. */
const MAX_PENDING_SESSIONS = 200

export interface UserHooksDeps {
  /** Read on every event so edits apply to the next call. */
  hooks: () => readonly UserHookConfig[]
  workspaceDir: string
  /** Files a sandboxed hook may not even read (secret store, decrypted mirror); read per run. */
  protectedPaths: () => readonly string[]
  /** The shell tool's sandbox switch (设置 › 常规): 'off' runs hooks unsandboxed too. */
  sandboxMode: () => 'auto' | 'off'
  sandbox: Sandbox
  cliEnv: () => Promise<Pick<CliEnv, 'env'>>
  platform?: NodeJS.Platform
  logger: Logger
  now?: () => number
  /** Tests: replace the process runner. */
  run?: (
    command: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv; cwd: string; input: string; timeoutMs: number },
  ) => Promise<HookExecution>
}

export interface UserHooks {
  /** Registered on the kernel HookRunner. */
  readonly hook: Hook
  /** A conversation was created: its first prompt runs the SessionStart hooks. */
  markNewThread(threadId: ThreadId): void
  lastRun(id: string): UserHookRunSummary | undefined
  sandboxAvailable(): boolean
  /** Run one hook once with a sample payload of its event (设置 › 扩展 › 测试). */
  test(hook: UserHookConfig): Promise<UserHookTestResult>
}

const KERNEL_EVENTS: readonly HookEventName[] = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']

const SAMPLE: Record<UserHookEvent, Parameters<typeof hookInput>[1]> = {
  SessionStart: { threadId: 'thr_test' },
  UserPromptSubmit: { threadId: 'thr_test', turnId: 'trn_test', text: 'hello' },
  PreToolUse: { threadId: 'thr_test', turnId: 'trn_test', toolName: 'shell', input: { command: 'echo hello' } },
  PostToolUse: {
    threadId: 'thr_test',
    turnId: 'trn_test',
    toolName: 'shell',
    input: { command: 'echo hello' },
    output: { ok: true, stdout: 'hello\n' },
  },
  Stop: { threadId: 'thr_test', turnId: 'trn_test', text: 'Done.' },
}

const stringifyOutput = (output: unknown): string => {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output) ?? ''
  } catch {
    return String(output)
  }
}

export function createUserHooks(deps: UserHooksDeps): UserHooks {
  const log = deps.logger.child('user-hooks')
  const now = deps.now ?? Date.now
  const platform = deps.platform ?? process.platform
  const lastRuns = new Map<string, UserHookRunSummary>()
  const newThreads = new Set<ThreadId>()

  const sandboxAvailable = (): boolean => deps.sandbox.kind !== 'none' && deps.sandboxMode() !== 'off'

  const execute = async (hook: UserHookConfig, input: string): Promise<HookExecution> => {
    const shell = shellCommandFor(platform, hook.command)
    const sandboxed = hook.sandbox && sandboxAvailable()
    const wrapped = sandboxed
      ? deps.sandbox.wrap(shell.command, shell.args, {
          writableRoots: [deps.workspaceDir, tmpdir()],
          network: true,
          readDeny: deps.protectedPaths(),
        })
      : shell
    const cli = await deps.cliEnv()
    const env = { ...cli.env, AIWC_WORKSPACE: deps.workspaceDir, AIWC_HOOK_ID: hook.id }
    if (deps.run)
      return deps.run(wrapped.command, wrapped.args, { env, cwd: deps.workspaceDir, input, timeoutMs: hook.timeoutMs })
    const started = now()
    const result = await runProcess(wrapped.command, wrapped.args, {
      env,
      cwd: deps.workspaceDir,
      input,
      timeoutMs: hook.timeoutMs,
      maxOutputChars: MAX_HOOK_OUTPUT_CHARS,
    })
    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      durationMs: now() - started,
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    }
  }

  const runOne = async (
    hook: UserHookConfig,
    event: UserHookEvent,
    payload: Parameters<typeof hookInput>[1],
  ): Promise<{ decision: HookDecision; exec: HookExecution }> => {
    const exec = await execute(hook, hookInput(event, payload, deps.workspaceDir))
    const decision = interpretHookResult(event, exec)
    lastRuns.set(hook.id, {
      at: now(),
      outcome: decision.outcome,
      exitCode: exec.exitCode,
      durationMs: exec.durationMs,
      ...(decision.message ? { message: decision.message } : {}),
    })
    if (decision.outcome === 'failed' || decision.outcome === 'timeout')
      log.warn('user hook failed', { id: hook.id, event, outcome: decision.outcome, exitCode: exec.exitCode })
    return { decision, exec }
  }

  const matching = (event: UserHookEvent, toolName?: string): UserHookConfig[] =>
    deps.hooks().filter((h) => {
      if (!h.enabled || h.event !== event) return false
      if (!TOOL_HOOK_EVENTS.includes(event)) return true
      return toolName !== undefined && (compileHookMatcher(h.matcher)?.test(toolName) ?? false)
    })

  /** Runs every matching hook in order, merging like the kernel runner: first block wins, contexts add up. */
  const runEvent = async (event: UserHookEvent, payload: HookPayload): Promise<HookResult> => {
    const result: HookResult = {}
    const contexts: string[] = []
    const feedback: string[] = []
    let input = payload.input
    for (const hook of matching(event, payload.toolName)) {
      const { decision } = await runOne(hook, event, {
        threadId: payload.threadId,
        turnId: payload.turnId,
        toolName: payload.toolName,
        input,
        output: payload.output,
        text: payload.text,
        channel: payload.origin?.channel,
        profile: payload.profile,
      })
      if (decision.context) contexts.push(decision.context)
      if (decision.feedback) feedback.push(decision.feedback)
      if (decision.updatedInput) {
        input = decision.updatedInput
        result.updatedInput = decision.updatedInput
      }
      if (decision.block) {
        result.block = { reason: decision.block }
        break
      }
    }
    if (contexts.length) result.additionalContext = contexts.join('\n')
    if (feedback.length) result.updatedOutput = `${stringifyOutput(payload.output)}\n\n[hook]\n${feedback.join('\n')}`
    return result
  }

  const hook: Hook = {
    name: 'user.hooks',
    events: KERNEL_EVENTS,
    async run(event, payload) {
      switch (event) {
        case 'UserPromptSubmit': {
          let sessionContext: string | undefined
          if (newThreads.delete(payload.threadId))
            sessionContext = (await runEvent('SessionStart', payload)).additionalContext
          const prompt = await runEvent('UserPromptSubmit', payload)
          const contexts = [sessionContext, prompt.additionalContext].filter(Boolean)
          return { ...prompt, ...(contexts.length ? { additionalContext: contexts.join('\n') } : {}) }
        }
        case 'PreToolUse':
        case 'PostToolUse':
        case 'Stop':
          return runEvent(event, payload)
        case 'SessionStart':
        case 'PreCompact':
        case 'PostCompact':
        case 'TurnAborted':
          return undefined
      }
    },
  }

  return {
    hook,
    markNewThread(threadId) {
      if (!deps.hooks().some((h) => h.enabled && h.event === 'SessionStart')) return
      if (newThreads.size >= MAX_PENDING_SESSIONS) {
        const oldest = newThreads.values().next().value
        if (oldest !== undefined) newThreads.delete(oldest)
      }
      newThreads.add(threadId)
    },
    lastRun: (id) => lastRuns.get(id),
    sandboxAvailable,
    async test(config) {
      const { decision, exec } = await runOne(config, config.event, SAMPLE[config.event])
      return {
        at: now(),
        outcome: decision.outcome,
        exitCode: exec.exitCode,
        durationMs: exec.durationMs,
        ...(decision.message ? { message: decision.message } : {}),
        stdout: exec.stdout.slice(0, TEST_OUTPUT_CHARS),
        stderr: (exec.spawnError ?? exec.stderr).slice(0, TEST_OUTPUT_CHARS),
      }
    },
  }
}
