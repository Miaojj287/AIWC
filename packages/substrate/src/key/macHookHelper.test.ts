/**
 * Supervision of the login-hook helper, driven by a stand-in shell script: it must stop waiting when
 * the run is cancelled or WeChat quits, instead of sitting out its whole deadline.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runHookHelper } from './macosMemoryScanner'

const dir = mkdtempSync(join(tmpdir(), 'aiwc-hook-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeHelper(name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

describe.skipIf(process.platform === 'win32')('runHookHelper', () => {
  it('reports the armed hook with its deadline and returns the captured key', async () => {
    const helper = fakeHelper('ok.sh', `echo "hook installed" >&2\necho ${'b'.repeat(64)}`)
    const armed: number[] = []
    const result = await runHookHelper(helper, 1, {
      timeoutMs: 30_000,
      now: () => 1_000,
      onArmed: (until) => armed.push(until),
      isProcessAlive: () => true,
    })
    expect(result).toEqual({ key: 'b'.repeat(64) })
    expect(armed).toEqual([31_000])
  })

  it('kills the helper on abort instead of waiting out its deadline', async () => {
    const helper = fakeHelper('wait.sh', 'echo "hook installed" >&2\nexec sleep 30')
    const controller = new AbortController()
    const started = Date.now()
    const pending = runHookHelper(helper, 1, {
      signal: controller.signal,
      onArmed: () => controller.abort(),
      isProcessAlive: () => true,
    })
    await expect(pending).resolves.toMatchObject({ code: 'ABORTED' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('gives up as soon as the hooked WeChat process is gone', async () => {
    const helper = fakeHelper('orphan.sh', 'echo "hook installed" >&2\nexec sleep 30')
    const started = Date.now()
    const result = await runHookHelper(helper, 1, { isProcessAlive: () => false })
    expect(result).toMatchObject({ code: 'PROCESS_EXITED' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('maps the helper timeout so the caller can say the login never came', async () => {
    const helper = fakeHelper('timeout.sh', 'echo "ERROR:HOOK_FAILED:hook timeout"\nexit 1')
    const result = await runHookHelper(helper, 1, { isProcessAlive: () => true })
    expect(result).toMatchObject({ code: 'HOOK_FAILED', needsAuthorization: false })
  })
})
