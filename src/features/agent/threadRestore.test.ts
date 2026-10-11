// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadId } from '@aiwc/protocol'
import { clearSavedTabs, MAX_RESTORED_TABS, readSavedTabs, tabsToSave, writeSavedTabs } from './threadRestore'

const id = (s: string) => s as ThreadId

afterEach(clearSavedTabs)

describe('saved Agent tabs', () => {
  it('round-trips the open tabs and the front one', () => {
    writeSavedTabs({ openIds: [id('thr_a'), id('thr_b')], activeThreadId: id('thr_b') })
    expect(readSavedTabs()).toEqual({ openIds: ['thr_a', 'thr_b'], activeThreadId: 'thr_b' })
  })

  it('leaves out local drafts and survives a corrupted entry', () => {
    expect(tabsToSave([id('thr_a'), id('thr_local')], id('thr_local'), [id('thr_local')])).toEqual({
      openIds: ['thr_a'],
      activeThreadId: null,
    })
    localStorage.setItem('aiwc.agent.openThreads.v1', '{not json')
    expect(readSavedTabs()).toBeUndefined()
    localStorage.setItem('aiwc.agent.openThreads.v1', JSON.stringify({ openIds: [1, 'thr_a'], activeThreadId: 'x' }))
    expect(readSavedTabs()).toEqual({ openIds: ['thr_a'], activeThreadId: 'thr_a' })
  })

  it('bounds how many tabs come back', () => {
    const many = Array.from({ length: MAX_RESTORED_TABS + 5 }, (_, i) => id(`thr_${i}`))
    writeSavedTabs({ openIds: many, activeThreadId: many[0]! })
    expect(readSavedTabs()?.openIds).toHaveLength(MAX_RESTORED_TABS)
  })
})
