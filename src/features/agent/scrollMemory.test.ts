import { afterEach, describe, expect, it } from 'vitest'
import { __resetScrollMemoryForTests, recalledScroll, rememberScroll } from './scrollMemory'

afterEach(__resetScrollMemoryForTests)

describe('scroll memory', () => {
  it('remembers the latest position per conversation', () => {
    rememberScroll('thr_a', { top: 120, atBottom: false })
    rememberScroll('thr_a', { top: 300, atBottom: true })
    expect(recalledScroll('thr_a')).toEqual({ top: 300, atBottom: true })
    expect(recalledScroll('thr_b')).toBeUndefined()
  })

  it('forgets the least recently read conversations first', () => {
    for (let i = 0; i < 51; i++) rememberScroll(`thr_${i}`, { top: i, atBottom: false })
    expect(recalledScroll('thr_0')).toBeUndefined()
    expect(recalledScroll('thr_50')).toEqual({ top: 50, atBottom: false })
  })
})
