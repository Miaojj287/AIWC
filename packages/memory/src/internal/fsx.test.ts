import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyedMutex, withFileLock } from './fsx'

// /dev/fd lists this process's open descriptors on macOS and Linux.
const openDescriptors = () => readdirSync('/dev/fd').length

describe.skipIf(process.platform === 'win32')('withFileLock', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiwc-lock-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('closes every descriptor it opens and removes the lock file', async () => {
    const target = join(dir, 'MEMORY.md')
    await withFileLock(target, () => undefined)
    const before = openDescriptors()
    for (let i = 0; i < 50; i++) await withFileLock(target, () => undefined)
    // A leak would add one descriptor per acquisition (50); allow a little noise from the test runner.
    expect(openDescriptors() - before).toBeLessThan(5)
    expect(existsSync(`${target}.lock`)).toBe(false)
  })

  it('serialises concurrent holders of the same target', async () => {
    const target = join(dir, 'USER.md')
    const order: string[] = []
    const hold = (name: string) =>
      withFileLock(target, async () => {
        order.push(`${name}:in`)
        await new Promise((r) => setTimeout(r, 20))
        order.push(`${name}:out`)
      })
    await Promise.all([hold('a'), hold('b')])
    expect(order).toHaveLength(4)
    expect(order[1]).toBe(`${order[0]?.split(':')[0]}:out`)
  })
})

describe('KeyedMutex', () => {
  it('runs tasks for one key in call order and forgets the key once the queue drains', async () => {
    const mutex = new KeyedMutex()
    const order: string[] = []
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = mutex.run('2026-09-13', async () => {
      await gate
      order.push('first')
    })
    const second = mutex.run('2026-09-13', () => {
      order.push('second')
      return Promise.resolve()
    })
    const other = mutex.run('2026-09-14', () => {
      order.push('other key')
      return Promise.resolve()
    })
    await other
    expect(order).toEqual(['other key'])
    expect(mutex.size).toBe(1)

    release()
    await Promise.all([first, second])
    expect(order).toEqual(['other key', 'first', 'second'])
    expect(mutex.size).toBe(0)
  })

  it('keeps serving a key after a task fails and still releases it', async () => {
    const mutex = new KeyedMutex()
    await expect(mutex.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(mutex.size).toBe(0)
    await expect(mutex.run('k', () => Promise.resolve(2))).resolves.toBe(2)
    expect(mutex.size).toBe(0)
  })
})
