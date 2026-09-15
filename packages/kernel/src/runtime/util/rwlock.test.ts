import { describe, expect, it } from 'vitest'
import { createRwLock, type RwLock } from './rwlock'

/** Drains every pending promise callback, so "not granted yet" assertions are not racing a microtask. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Acquires in the background and records when the grant lands. */
function track(lock: RwLock, mode: 'shared' | 'exclusive'): { granted: () => boolean; release: Promise<() => void> } {
  let granted = false
  const release = lock.acquire(mode).then((rel) => {
    granted = true
    return rel
  })
  return { granted: () => granted, release }
}

describe('RwLock', () => {
  it('runs shared holders together and exclusive holders alone, FIFO', async () => {
    const lock = createRwLock()
    const log: string[] = []
    const r1 = await lock.acquire('shared')
    const r2 = await lock.acquire('shared')
    log.push('s1', 's2')
    const w = lock.acquire('exclusive').then((rel) => {
      log.push('w')
      return rel
    })
    const s3 = lock.acquire('shared').then((rel) => {
      log.push('s3')
      return rel
    })
    await Promise.resolve()
    expect(log).toEqual(['s1', 's2'])
    r1()
    r2()
    const relW = await w
    expect(log).toEqual(['s1', 's2', 'w'])
    relW()
    ;(await s3)()
    expect(log).toEqual(['s1', 's2', 'w', 's3'])
  })

  it('a shared release called twice frees only its own hold', async () => {
    const lock = createRwLock()
    const first = await lock.acquire('shared')
    const second = await lock.acquire('shared')
    const writer = track(lock, 'exclusive')
    first()
    first()
    await settle()
    // the second reader still holds the lock, so the writer must keep waiting
    expect(writer.granted()).toBe(false)
    second()
    ;(await writer.release)()
    expect(writer.granted()).toBe(true)
  })

  it('a stale exclusive release cannot unlock the next holder', async () => {
    const lock = createRwLock()
    const firstWriter = await lock.acquire('exclusive')
    const secondWriter = track(lock, 'exclusive')
    const reader = track(lock, 'shared')
    firstWriter()
    const releaseSecond = await secondWriter.release
    firstWriter()
    await settle()
    expect(reader.granted()).toBe(false)
    releaseSecond()
    ;(await reader.release)()
    expect(reader.granted()).toBe(true)
  })
})
