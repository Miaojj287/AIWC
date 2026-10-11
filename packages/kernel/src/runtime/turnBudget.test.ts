import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTurnBudget } from './turnBudget'

describe('createTurnBudget', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('expires after its budget when nothing pauses it', () => {
    const onExpire = vi.fn()
    createTurnBudget(1_000, onExpire)
    vi.advanceTimersByTime(999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('does not count time spent waiting for an approval', () => {
    const onExpire = vi.fn()
    const budget = createTurnBudget(1_000, onExpire)
    vi.advanceTimersByTime(600)
    const endWait = budget.pause()
    // the user answers 25 minutes later
    vi.advanceTimersByTime(25 * 60_000)
    expect(onExpire).not.toHaveBeenCalled()
    endWait()
    vi.advanceTimersByTime(399)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('stays paused until the last of overlapping waits ends, and ending a wait twice is harmless', () => {
    const onExpire = vi.fn()
    const budget = createTurnBudget(1_000, onExpire)
    const a = budget.pause()
    const b = budget.pause()
    a()
    a()
    vi.advanceTimersByTime(5_000)
    expect(onExpire).not.toHaveBeenCalled()
    b()
    vi.advanceTimersByTime(1_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('never fires after dispose, and an expired budget does not fire again', () => {
    const onExpire = vi.fn()
    const disposed = createTurnBudget(1_000, onExpire)
    disposed.dispose()
    vi.advanceTimersByTime(2_000)
    expect(onExpire).not.toHaveBeenCalled()

    const expired = createTurnBudget(1_000, onExpire)
    vi.advanceTimersByTime(1_000)
    const endWait = expired.pause()
    endWait()
    vi.advanceTimersByTime(5_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})
