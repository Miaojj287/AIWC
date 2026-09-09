import { describe, expect, it } from 'vitest'
import { LoopGuard, callFingerprint } from './loopGuard'
import { createRwLock } from './util/rwlock'
import { estimateTokens, truncateToTokens } from '@aiwc/protocol'

describe('LoopGuard', () => {
  it('fingerprints ignore key order', () => {
    expect(callFingerprint({ toolName: 't', input: { a: 1, b: [1, { c: 2 }] } })).toBe(callFingerprint({ toolName: 't', input: { b: [1, { c: 2 }], a: 1 } }))
  })
  it('trips on three identical calls', () => {
    const g = new LoopGuard()
    expect(g.push([{ toolName: 'a', input: 1 }])).toBe(false)
    expect(g.push([{ toolName: 'a', input: 1 }])).toBe(false)
    expect(g.push([{ toolName: 'a', input: 1 }])).toBe(true)
  })
  it('trips on A-B-A-B but not A-B-C-A', () => {
    const g = new LoopGuard()
    expect(g.push([{ toolName: 'a', input: 1 }, { toolName: 'b', input: 1 }, { toolName: 'a', input: 1 }])).toBe(false)
    expect(g.push([{ toolName: 'b', input: 1 }])).toBe(true)
    const h = new LoopGuard()
    expect(h.push([{ toolName: 'a', input: 1 }, { toolName: 'b', input: 1 }, { toolName: 'c', input: 1 }, { toolName: 'a', input: 1 }])).toBe(false)
  })
})

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
})

describe('truncateToTokens (protocol implementation)', () => {
  it('never exceeds the cap and keeps the marker', () => {
    const text = truncateToTokens('中文内容'.repeat(500), 40)
    expect(estimateTokens(text)).toBeLessThanOrEqual(40)
    expect(text).toMatch(/已截断 \d+ 字\]$/)
    expect(truncateToTokens('short', 10)).toBe('short')
  })
})
