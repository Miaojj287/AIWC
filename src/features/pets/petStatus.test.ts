import { describe, expect, it } from 'vitest'
import { petStatusItems, petStatusSummary, type PetFleet } from './petStatus'

const ALL_ON = { showRunning: true, showDone: true, showUnread: true }
const fleet = (patch: Partial<PetFleet> = {}): PetFleet => ({
  running: 0,
  waiting: 0,
  done: 0,
  failed: 0,
  targets: {},
  ...patch,
})

describe('petStatusItems', () => {
  it('shows nothing while every count is zero or unknown', () => {
    expect(petStatusItems(undefined, ALL_ON)).toEqual([])
    expect(petStatusItems(fleet(), ALL_ON)).toEqual([])
    expect(petStatusItems(fleet({ unread: { messages: 0, chats: 0, capped: false } }), ALL_ON)).toEqual([])
  })

  it('orders the counts by urgency and names each one', () => {
    const items = petStatusItems(
      fleet({
        running: 2,
        waiting: 1,
        done: 3,
        failed: 1,
        targets: { waiting: 'tw', running: 'tr', done: 'td' },
        unread: { messages: 12, chats: 4, capped: false },
      }),
      ALL_ON,
    )
    expect(items.map((i) => i.kind)).toEqual(['waiting', 'running', 'done', 'failed', 'unread'])
    expect(items.map((i) => i.label)).toEqual([
      '1 个会话等你确认',
      '2 个会话正在运行',
      '3 个会话已完成，还没看',
      '1 个会话出错了',
      '微信 12 条未读（4 个聊天）',
    ])
    expect(items[0]).toMatchObject({ threadId: 'tw', actionable: true })
    // nothing new to open (the failed thread is the one on screen): shown, but not clickable
    expect(items[3]).toMatchObject({ threadId: undefined, actionable: false })
    expect(items[4]).toMatchObject({ actionable: true })
    expect(petStatusSummary(items)).toBe(
      '1 个会话等你确认；2 个会话正在运行；3 个会话已完成，还没看；1 个会话出错了；微信 12 条未读（4 个聊天）',
    )
  })

  it('follows the 状态读数 toggles', () => {
    const f = fleet({ running: 1, waiting: 1, done: 1, failed: 1, unread: { messages: 3, chats: 1, capped: false } })
    expect(petStatusItems(f, { ...ALL_ON, showRunning: false }).map((i) => i.kind)).toEqual([
      'done',
      'failed',
      'unread',
    ])
    expect(petStatusItems(f, { ...ALL_ON, showDone: false }).map((i) => i.kind)).toEqual([
      'waiting',
      'running',
      'unread',
    ])
    expect(petStatusItems(f, { ...ALL_ON, showUnread: false }).map((i) => i.kind)).not.toContain('unread')
  })

  it('caps long counts at 99+ and marks a partial unread scan as a lower bound', () => {
    const [running, unread] = petStatusItems(
      fleet({ running: 120, unread: { messages: 40, chats: 200, capped: true } }),
      ALL_ON,
    )
    expect(running?.text).toBe('99+')
    expect(unread?.text).toBe('40+')
    expect(unread?.label).toBe('微信至少 40 条未读')
  })
})
