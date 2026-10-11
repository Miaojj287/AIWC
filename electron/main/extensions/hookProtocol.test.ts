import { describe, expect, it } from 'vitest'
import { hookInput, interpretHookResult, type HookExecution } from './hookProtocol'

const run = (patch: Partial<HookExecution>): HookExecution => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  durationMs: 5,
  ...patch,
})

describe('interpretHookResult', () => {
  it('exit 2 blocks with stderr where the event can block, and becomes feedback after a tool ran', () => {
    expect(interpretHookResult('PreToolUse', run({ exitCode: 2, stderr: 'no rm\n' }))).toMatchObject({
      outcome: 'blocked',
      block: 'no rm',
    })
    expect(interpretHookResult('Stop', run({ exitCode: 2, stderr: 'add tests' })).block).toBe('add tests')
    expect(interpretHookResult('PostToolUse', run({ exitCode: 2, stderr: 'lint failed' }))).toMatchObject({
      outcome: 'context',
      feedback: 'lint failed',
    })
    expect(interpretHookResult('SessionStart', run({ exitCode: 2, stderr: 'x' })).outcome).toBe('failed')
  })

  it('reads the JSON decisions (block, continue:false, deny) and ignores allow', () => {
    const json = (v: unknown) => run({ stdout: JSON.stringify(v) })
    expect(interpretHookResult('UserPromptSubmit', json({ decision: 'block', reason: 'r' })).block).toBe('r')
    expect(interpretHookResult('Stop', json({ continue: false, stopReason: 's' })).block).toBe('s')
    expect(
      interpretHookResult(
        'PreToolUse',
        json({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'p' } }),
      ).block,
    ).toBe('p')
    expect(interpretHookResult('PreToolUse', json({ hookSpecificOutput: { permissionDecision: 'allow' } }))).toEqual({
      outcome: 'allowed',
    })
    expect(
      interpretHookResult('PreToolUse', json({ hookSpecificOutput: { updatedInput: { command: 'ls' } } })),
    ).toMatchObject({ outcome: 'context', updatedInput: { command: 'ls' } })
  })

  it('adds plain stdout as context only for prompt and session events', () => {
    expect(interpretHookResult('UserPromptSubmit', run({ stdout: 'branch: main\n' })).context).toBe('branch: main')
    expect(interpretHookResult('SessionStart', run({ stdout: 'hello' })).context).toBe('hello')
    expect(interpretHookResult('PreToolUse', run({ stdout: 'noise' }))).toEqual({ outcome: 'allowed' })
  })

  it('treats other exit codes, timeouts and spawn errors as non-blocking failures', () => {
    expect(interpretHookResult('PreToolUse', run({ exitCode: 1, stderr: 'oops\nmore' }))).toEqual({
      outcome: 'failed',
      message: 'oops',
    })
    expect(interpretHookResult('PreToolUse', run({ exitCode: null, timedOut: true })).outcome).toBe('timeout')
    expect(interpretHookResult('Stop', run({ spawnError: 'ENOENT' })).outcome).toBe('failed')
  })
})

describe('hookInput', () => {
  it('uses the Claude Code / Codex keys per event', () => {
    const pre = JSON.parse(
      hookInput('PreToolUse', { threadId: 't', toolName: 'shell', input: { command: 'ls' } }, '/w'),
    )
    expect(pre).toMatchObject({ hook_event_name: 'PreToolUse', session_id: 't', cwd: '/w', tool_name: 'shell' })
    expect(pre.tool_input).toEqual({ command: 'ls' })
    expect(JSON.parse(hookInput('Stop', { threadId: 't', text: 'done' }, '/w')).last_assistant_message).toBe('done')
    expect(JSON.parse(hookInput('UserPromptSubmit', { threadId: 't', text: 'hi' }, '/w')).prompt).toBe('hi')
  })
})
