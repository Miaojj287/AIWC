import { describe, expect, it } from 'vitest'
import type { SessionSource } from '@aiwc/protocol'
import { buildSessionKey, parseSessionKey } from './sessionKey'

const dm = (over: Partial<SessionSource> = {}): SessionSource => ({
  channel: 'wechat-ilink',
  peerId: 'u_alice',
  chatId: 'u_alice',
  chatType: 'dm',
  ...over,
})

describe('buildSessionKey', () => {
  it('isolates DMs per peer', () => {
    expect(buildSessionKey(dm())).toBe('agent:wechat-ilink:dm:u_alice')
    expect(buildSessionKey(dm({ peerId: 'u_bob', chatId: 'u_bob' }))).toBe('agent:wechat-ilink:dm:u_bob')
  })

  it('falls back to chatId for a DM without peerId', () => {
    expect(buildSessionKey(dm({ peerId: '' }))).toBe('agent:wechat-ilink:dm:u_alice')
  })

  it('isolates group sessions per participant', () => {
    const a = buildSessionKey({ channel: 'wechat-ilink', chatType: 'group', chatId: 'g1@chatroom', peerId: 'u_alice' })
    const b = buildSessionKey({ channel: 'wechat-ilink', chatType: 'group', chatId: 'g1@chatroom', peerId: 'u_bob' })
    expect(a).toBe('agent:wechat-ilink:group:g1@chatroom:u_alice')
    expect(b).toBe('agent:wechat-ilink:group:g1@chatroom:u_bob')
    expect(a).not.toBe(b)
  })

  it('appends the thread id when present', () => {
    expect(buildSessionKey(dm({ threadId: 't9' }))).toBe('agent:wechat-ilink:dm:u_alice:t9')
    expect(buildSessionKey({ channel: 'desktop', chatType: 'group', chatId: 'g', peerId: 'me', threadId: 't' })).toBe('agent:desktop:group:g:me:t')
  })

  it('never lets an identifier alias another chat through the separator', () => {
    expect(buildSessionKey(dm({ peerId: 'x:dm:y', chatId: 'x:dm:y' }))).toBe('agent:wechat-ilink:dm:x_dm_y')
  })

  it('round-trips through parseSessionKey', () => {
    const key = buildSessionKey({ channel: 'wechat-ilink', chatType: 'group', chatId: 'g1@chatroom', peerId: 'u_alice', threadId: 't1' })
    expect(parseSessionKey(key)).toEqual({ channel: 'wechat-ilink', chatType: 'group', chatId: 'g1@chatroom', peerId: 'u_alice', threadId: 't1' })
    expect(parseSessionKey(buildSessionKey(dm()))).toEqual({ channel: 'wechat-ilink', chatType: 'dm', chatId: 'u_alice', peerId: 'u_alice', threadId: undefined })
    expect(parseSessionKey('nope')).toBeUndefined()
  })
})
