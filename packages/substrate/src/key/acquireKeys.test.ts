import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { acquireKeys } from './acquireKeys'

const root = mkdtempSync(join(tmpdir(), 'aiwc-acquire-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const terminal = (steps: readonly KeyAcquireStep[]) => steps.every((s) => s.status === 'done' || s.status === 'failed')

describe('acquireKeys', () => {
  it('closes all four steps when the account directory is missing (no ○ left behind)', async () => {
    const pushed: KeyAcquireStep[] = []
    const result = await acquireKeys({
      dbRoot: join(root, 'nowhere'),
      wxid: 'wxid_test',
      strategy: 'memory_scan',
      nativeDir: join(root, 'native'),
      onStep: (step) => pushed.push(step),
    })
    expect(result.steps.map((s) => s.id)).toEqual(['db_key', 'image_xor', 'image_aes', 'verify'])
    expect(terminal(result.steps)).toBe(true)
    expect(result.steps.slice(1).every((s) => s.failure === 'skipped')).toBe(true)
    // The renderer only sees pushes: they must end terminal too.
    const last = new Map(pushed.map((s) => [s.id, s]))
    expect(terminal([...last.values()])).toBe(true)
  })

  it('ends a cancelled run with every open step marked cancelled', async () => {
    const account = join(root, 'wxid_test_ab12')
    mkdirSync(join(account, 'db_storage'), { recursive: true })
    const controller = new AbortController()
    const result = await acquireKeys({
      dbRoot: root,
      wxid: 'wxid_test',
      strategy: 'memory_scan',
      nativeDir: join(root, 'native'),
      signal: controller.signal,
      // Cancel as soon as the first step settles.
      onStep: (step) => {
        if (step.id === 'db_key' && step.status !== 'doing') controller.abort()
      },
    })
    expect(result.cancelled).toBe(true)
    expect(terminal(result.steps)).toBe(true)
    expect(result.steps.filter((s) => s.id !== 'db_key').every((s) => s.failure === 'cancelled')).toBe(true)
    expect(result.dbKeyHex).toBeUndefined()
  })
})
