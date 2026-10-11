// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onCommand, type CommandMap } from '@/app/commands'
import { __resetShellStoreForTests, useShellStore } from '@/shell/shellStore'
import { openPetStatus } from './actions'

const offs: Array<() => void> = []
afterEach(() => {
  offs.splice(0).forEach((off) => off())
  __resetShellStoreForTests()
})

describe('openPetStatus', () => {
  it('opens the thread a count names', () => {
    const openThread = vi.fn()
    offs.push(onCommand('agent.openThread', openThread))
    openPetStatus({ kind: 'done', threadId: 't3' })
    expect(openThread).toHaveBeenCalledWith({ threadId: 't3' })
  })

  it('does nothing for a count without a thread to open', () => {
    const openThread = vi.fn()
    offs.push(onCommand('agent.openThread', openThread))
    openPetStatus({ kind: 'running' })
    expect(openThread).not.toHaveBeenCalled()
  })

  it('opens 聊天 narrowed to unread chats for WeChat unread', () => {
    const railSelect = vi.fn((payload: CommandMap['rail.select']) => useShellStore.getState().setRail(payload.fn))
    offs.push(onCommand('rail.select', railSelect))
    openPetStatus({ kind: 'unread' })
    expect(railSelect).toHaveBeenCalledWith({ fn: 'chat' })
    expect(useShellStore.getState().listFilters).toEqual({ unreadOnly: true })
  })
})
