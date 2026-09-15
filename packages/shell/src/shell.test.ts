import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '@aiwc/protocol'
import { createCliEnv } from './env'
import { runProcess, stripAnsi } from './process'
import { createSandbox, seatbeltProfile } from './sandbox'
import { createShellTool, shellCommandFor, type ShellOutput } from './shellTool'

const ctx = (signal = new AbortController().signal): ToolContext => ({
  threadId: 't' as ToolContext['threadId'],
  turnId: 'u' as ToolContext['turnId'],
  stepId: 's' as ToolContext['stepId'],
  callId: 'c' as ToolContext['callId'],
  channel: 'desktop',
  profile: 'desktop-chat',
  signal,
  services: {},
  progress: () => {},
  depth: 0,
})

describe('runProcess', () => {
  it('captures output, strips ANSI and never uses a shell', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("\\u001b[32mhi $HOME\\u001b[0m")'], { env: process.env })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('hi $HOME')
    expect(stripAnsi('[1;31mred[0m')).toBe('red')
  })

  it.skipIf(process.platform === 'win32')('streams output before exit and kills the whole group on abort', async () => {
    const controller = new AbortController()
    let seen = ''
    const started = Date.now()
    const script = [
      'const { spawn } = require("child_process")',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })',
      'console.log("pid=" + child.pid + " https://example.com/verify")',
      'setTimeout(() => {}, 60000)',
    ].join(';')
    const result = await runProcess(process.execPath, ['-e', script], {
      env: process.env,
      signal: controller.signal,
      onOutput: (chunk) => {
        seen += chunk
        if (seen.includes('verify')) controller.abort()
      },
    })
    expect(result.aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(10_000)
    const grandchild = Number(/pid=(\d+)/.exec(seen)?.[1])
    await new Promise((r) => setTimeout(r, 300))
    expect(() => process.kill(grandchild, 0)).toThrow()
  })

  it('times out and reports spawn failures instead of throwing', async () => {
    expect((await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { env: process.env, timeoutMs: 300 })).timedOut).toBe(true)
    expect((await runProcess('/definitely/not/here', [], { env: process.env })).spawnError).toBeTruthy()
  })
})

describe('createCliEnv', () => {
  it('searches preferred dirs first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiwc-shell-env-'))
    const bin = join(dir, 'fake-cli')
    await writeFile(bin, '#!/bin/sh\necho ok\n')
    await chmod(bin, 0o755)
    const env = await createCliEnv({ env: { PATH: '/usr/bin:/bin' }, home: dir, preferredDirs: [dir], probeLoginShell: false, platform: 'darwin' })
    expect(await env.which('fake-cli')).toBe(bin)
    expect(await env.which('not-a-cli-anywhere')).toBeUndefined()
    expect(env.path.split(':')[0]).toBe(dir)
  })
})

describe('seatbelt profile', () => {
  it('allows writes only in the given roots and denies the protected reads', () => {
    const p = seatbeltProfile({ writableRoots: ['/w/ork', '/x'], network: false, readDeny: ['/data/secrets.bin'] })
    expect(p).toContain('(deny default)')
    expect(p).toContain('(subpath "/w/ork")')
    expect(p).toContain('(deny file-read* (literal "/data/secrets.bin") (subpath "/data/secrets.bin"))')
    expect(p).not.toContain('network-outbound')
    expect(seatbeltProfile({ writableRoots: [], network: true })).toContain('(allow network-outbound)')
  })
})

describe('shell tool', () => {
  const workspace = async () => mkdtemp(join(tmpdir(), 'aiwc-shell-ws-'))
  const run = async (tool: ReturnType<typeof createShellTool>, input: Parameters<ReturnType<typeof createShellTool>['execute']>[0]) => {
    const r = await tool.execute(input, ctx())
    return { ...r, out: r.content as unknown as ShellOutput }
  }

  it('classifies per call and exposes the allow key', () => {
    const tool = createShellTool({ workspaceDir: '/tmp', sandbox: createSandbox('linux') })
    expect(tool.classify?.({ command: 'ls' })).toMatchObject({ risk: 'read', allowKey: 'shell:ls' })
    expect(tool.classify?.({ command: 'git commit -m x' })).toMatchObject({ risk: 'write', allowKey: 'shell:git commit' })
    expect(tool.classify?.({ command: 'ls', escalate: true, reason: 'install' })).toMatchObject({ risk: 'write', canAllowAlways: false })
    expect(tool.summarize?.({ command: 'echo   hi' })).toBe('$ echo hi')
  })

  it.skipIf(process.platform === 'win32')('runs in the workspace with the login-shell PATH and returns structured output', async () => {
    const ws = await workspace()
    const tool = createShellTool({ workspaceDir: ws, sandbox: createSandbox('linux'), cliEnv: { path: '/usr/bin:/bin', env: { PATH: '/usr/bin:/bin' }, which: async () => undefined } })
    const ok = await run(tool, { command: 'echo hello > out.txt && cat out.txt && pwd' })
    expect(ok.isError).toBe(false)
    expect(ok.out).toMatchObject({ ok: true, exitCode: 0, sandboxed: false })
    expect(ok.out.stdout).toContain('hello')
    expect(ok.out.stdout).toContain(ws.replace('/private', ''))
    const bad = await run(tool, { command: 'exit 3' })
    expect(bad.isError).toBe(true)
    expect(bad.out.exitCode).toBe(3)
    const missing = await run(tool, { command: 'no-such-command-xyz' })
    expect(missing.out.hint).toMatch(/命令不存在/)
    const slow = await run(tool, { command: 'sleep 5', timeoutMs: 1000 })
    expect(slow.out.timedOut).toBe(true)
    expect(slow.out.hint).toMatch(/终止/)
    const nowhere = await run(tool, { command: 'ls', cwd: '/definitely/missing' })
    expect(nowhere.isError).toBe(true)
  })

  it.skipIf(process.platform !== 'darwin')('the seatbelt sandbox blocks writes outside the workspace and explains how to escalate', async () => {
    const ws = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'aiwc-shell-outside-'))
    const tool = createShellTool({ workspaceDir: ws, cliEnv: { path: '/usr/bin:/bin', env: { PATH: '/usr/bin:/bin' }, which: async () => undefined } })
    // The workspace itself is writable; tmpdir is too (it is where `outside` lives), so pick a home path instead.
    const inside = await run(tool, { command: 'echo a > a.txt && cat a.txt' })
    expect(inside.out).toMatchObject({ ok: true, sandboxed: true })
    const home = await run(tool, { command: 'touch "$HOME/.aiwc-sandbox-probe" && echo wrote' })
    expect(home.out.ok).toBe(false)
    expect(home.out.hint).toMatch(/escalate/)
    const escalated = await run(tool, { command: `touch "${outside}/probe" && echo wrote`, escalate: true, reason: 'test' })
    expect(escalated.out).toMatchObject({ ok: true, sandboxed: false })
    expect(shellCommandFor('darwin', 'x').command).toBe('/bin/zsh')
  })
})
