import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asThreadId, asTurnId, UserHookConfigSchema, type UserHookConfig } from '@aiwc/protocol'
import { createHookRunner } from '@aiwc/kernel'
import { createSandbox } from '@aiwc/shell'
import { nullLogger } from '../log'
import { createUserHooks } from './userHooks'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const hook = (patch: Partial<UserHookConfig> & Pick<UserHookConfig, 'event' | 'command'>): UserHookConfig =>
  UserHookConfigSchema.parse({ id: `hk_${Math.random().toString(36).slice(2, 10)}`, ...patch })

function setup(hooks: UserHookConfig[]) {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'aiwc-hooks-'))
  dirs.push(workspaceDir)
  const userHooks = createUserHooks({
    hooks: () => hooks,
    workspaceDir,
    protectedPaths: () => [],
    sandboxMode: () => 'off',
    // A real process, no OS sandbox: what is tested is the stdin / exit-code contract end to end.
    sandbox: createSandbox('linux'),
    cliEnv: async () => ({ env: { PATH: process.env.PATH } }),
    platform: 'linux',
    logger: nullLogger,
  })
  const runner = createHookRunner()
  runner.add(userHooks.hook)
  return { runner, userHooks, workspaceDir }
}

const threadId = asThreadId('thr_1')
const turnId = asTurnId('trn_1')

describe.skipIf(process.platform === 'win32')('user hooks (real commands)', () => {
  it('a PreToolUse hook matching the tool blocks it with stderr on exit 2; others do not run', async () => {
    const unmatched = hook({ event: 'PreToolUse', matcher: 'other|send_.*', command: 'exit 2' })
    const { runner, userHooks, workspaceDir } = setup([
      hook({
        event: 'PreToolUse',
        matcher: 'shell',
        command: 'cat > "$AIWC_WORKSPACE/in.json"; echo "no shell today" >&2; exit 2',
      }),
      unmatched,
    ])
    const result = await runner.run('PreToolUse', { threadId, turnId, toolName: 'shell', input: { command: 'ls' } })
    expect(result.block?.reason).toBe('no shell today')
    const stdin = JSON.parse(readFileSync(join(workspaceDir, 'in.json'), 'utf8'))
    expect(stdin).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'shell', tool_input: { command: 'ls' } })
    const other = await runner.run('PreToolUse', { threadId, turnId, toolName: 'read_file', input: {} })
    expect(other.block).toBeUndefined()
    expect(userHooks.lastRun(unmatched.id)).toBeUndefined()
  })

  it('SessionStart context joins the first prompt of a new thread only', async () => {
    const { runner, userHooks } = setup([
      hook({ event: 'SessionStart', command: 'echo "project: aiwc"' }),
      hook({ event: 'UserPromptSubmit', command: 'echo \'{"hookSpecificOutput":{"additionalContext":"be brief"}}\'' }),
    ])
    userHooks.markNewThread(threadId)
    const first = await runner.run('UserPromptSubmit', { threadId, turnId, text: 'hi' })
    expect(first.additionalContext).toBe('project: aiwc\nbe brief')
    const second = await runner.run('UserPromptSubmit', { threadId, turnId, text: 'again' })
    expect(second.additionalContext).toBe('be brief')
  })

  it('a failing or slow hook never blocks, and its last run is recorded', async () => {
    const failing = hook({ event: 'Stop', command: 'echo broken >&2; exit 1' })
    const slow = hook({ event: 'Stop', command: 'sleep 5', timeoutMs: 1_000 })
    const { runner, userHooks } = setup([failing, slow])
    const result = await runner.run('Stop', { threadId, turnId, text: 'done' })
    expect(result.block).toBeUndefined()
    expect(userHooks.lastRun(failing.id)).toMatchObject({ outcome: 'failed', exitCode: 1, message: 'broken' })
    expect(userHooks.lastRun(slow.id)?.outcome).toBe('timeout')
  }, 10_000)

  it('PostToolUse feedback is appended to the tool output; test() runs a sample payload', async () => {
    const post = hook({ event: 'PostToolUse', command: 'echo "check the diff" >&2; exit 2' })
    const { runner, userHooks } = setup([post])
    const result = await runner.run('PostToolUse', { threadId, turnId, toolName: 'shell', input: {}, output: 'ok' })
    expect(result.updatedOutput).toBe('ok\n\n[hook]\ncheck the diff')
    const tested = await userHooks.test(post)
    expect(tested).toMatchObject({ outcome: 'context', exitCode: 2, stderr: 'check the diff\n' })
  })
})

describe('user hooks sandbox', () => {
  it('reads the protected paths on every run, so a custom cache dir set later is denied too', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'aiwc-hooks-'))
    dirs.push(workspaceDir)
    let protectedList = ['/data/aiwc/secrets.bin']
    const seen: Array<readonly string[] | undefined> = []
    const userHooks = createUserHooks({
      hooks: () => [hook({ event: 'Stop', command: 'true' })],
      workspaceDir,
      protectedPaths: () => protectedList,
      sandboxMode: () => 'auto',
      sandbox: {
        kind: 'seatbelt',
        wrap: (command, args, spec) => {
          seen.push(spec.readDeny)
          return { command, args: [...args] }
        },
      },
      cliEnv: async () => ({ env: {} }),
      platform: 'linux',
      logger: nullLogger,
      run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }),
    })
    const runner = createHookRunner()
    runner.add(userHooks.hook)
    await runner.run('Stop', { threadId, turnId, text: 'done' })
    protectedList = [...protectedList, '/Volumes/cache/wcdb-plain']
    await runner.run('Stop', { threadId, turnId, text: 'done' })
    expect(seen).toEqual([['/data/aiwc/secrets.bin'], ['/data/aiwc/secrets.bin', '/Volumes/cache/wcdb-plain']])
  })
})
