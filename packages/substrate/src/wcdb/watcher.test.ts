import { describe, expect, it, vi } from 'vitest'
import { createDebouncedCollector, isRelevantDbFile } from './watcher'

describe('isRelevantDbFile', () => {
  it('accepts db / wal / shm and unknown names', () => {
    expect(isRelevantDbFile('message_0.db')).toBe(true)
    expect(isRelevantDbFile('message_0.db-wal')).toBe(true)
    expect(isRelevantDbFile('message_0.db-shm')).toBe(true)
    expect(isRelevantDbFile(null)).toBe(true)
    expect(isRelevantDbFile('notes.txt')).toBe(false)
  })
})

describe('createDebouncedCollector', () => {
  it('coalesces bursts into a single flush', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const collector = createDebouncedCollector(800, (items) => flushed.push(items))
    collector.push('a')
    collector.push('b')
    collector.push('a')
    vi.advanceTimersByTime(799)
    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(flushed).toEqual([['a', 'b']])
    vi.useRealTimers()
  })

  it('cancel prevents the pending flush', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const collector = createDebouncedCollector(500, (items) => flushed.push(items))
    collector.push('x')
    collector.cancel()
    vi.advanceTimersByTime(1000)
    expect(flushed).toHaveLength(0)
    vi.useRealTimers()
  })
})

it('flushes during continuous writes instead of waiting for silence', () => {
  vi.useFakeTimers()
  try {
    const flush = vi.fn()
    const collector = createDebouncedCollector(250, flush)
    for (let i = 0; i < 10; i++) {
      collector.push('message_0.db-wal')
      vi.advanceTimersByTime(100)
    }
    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(3)
    collector.cancel()
  } finally { vi.useRealTimers() }
})
