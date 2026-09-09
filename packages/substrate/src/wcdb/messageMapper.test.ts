import { describe, expect, it } from 'vitest'
import {
  classifyKind,
  deriveSeq,
  messageIdentityKey,
  resolveIsSelf,
  resolveLocalType,
  rowToWxMessage,
  splitLocalType,
  type MessageRowContext,
} from './messageMapper'

const dmCtx: MessageRowContext = { sessionId: 'wxid_friend', isGroup: false, selfWxid: 'wxid_me_1a2b' }

describe('splitLocalType', () => {
  it('splits the packed 64-bit local_type', () => {
    expect(splitLocalType(1)).toEqual({ base: 1, sub: 0 })
    expect(splitLocalType(49)).toEqual({ base: 49, sub: 0 })
    // 57 << 32 | 49 = quote appmsg
    expect(splitLocalType(244813135921)).toEqual({ base: 49, sub: 57 })
  })
})

describe('resolveLocalType', () => {
  it('prefers positive values across column aliases', () => {
    expect(resolveLocalType({ local_type: '3' })).toBe(3)
    expect(resolveLocalType({ type: 0, local_type: 34 })).toBe(34)
    expect(resolveLocalType({ Type: '' }, 1)).toBe(1)
  })
})

describe('deriveSeq', () => {
  it('uses sort_seq when positive', () => {
    expect(deriveSeq(500, 1700, 3)).toBe(500)
  })
  it('falls back to create_time*1000 + local_id', () => {
    expect(deriveSeq(0, 1700, 3)).toBe(1_700_003)
    expect(deriveSeq(-1, 1700, 3)).toBe(1_700_003)
  })
})

describe('classifyKind', () => {
  it('maps base types to protocol kinds', () => {
    expect(classifyKind(1, 'hi').kind).toBe('text')
    expect(classifyKind(3, '').kind).toBe('image')
    expect(classifyKind(34, '').kind).toBe('voice')
    expect(classifyKind(43, '').kind).toBe('video')
    expect(classifyKind(47, '').kind).toBe('sticker')
    expect(classifyKind(48, '').kind).toBe('location')
    expect(classifyKind(42, '').kind).toBe('card')
  })
  it('classifies appmsg subtypes', () => {
    expect(classifyKind(49, '<appmsg><type>6</type></appmsg>').kind).toBe('file')
    expect(classifyKind(49, '<appmsg><type>57</type></appmsg>').kind).toBe('quote')
    expect(classifyKind(49, '<appmsg><type>2000</type></appmsg>').kind).toBe('transfer')
    expect(classifyKind(49, '<appmsg><type>5</type></appmsg>').kind).toBe('link')
  })
  it('detects revoke system messages', () => {
    expect(classifyKind(10000, '"我"撤回了一条消息').kind).toBe('revoke')
    expect(classifyKind(10000, '进入了群聊').kind).toBe('system')
  })
})

describe('resolveIsSelf', () => {
  it('is true for is_send=1', () => {
    expect(resolveIsSelf({ is_send: 1 }, undefined, dmCtx)).toBe(true)
  })
  it('is true when sender matches self identity', () => {
    expect(resolveIsSelf({}, 'wxid_me', dmCtx)).toBe(true)
    expect(resolveIsSelf({}, 'wxid_me_1a2b', dmCtx)).toBe(true)
  })
  it('is true when real_sender_id matches myRowId', () => {
    expect(resolveIsSelf({ real_sender_id: 7 }, 'wxid_other', { ...dmCtx, myRowId: 7 })).toBe(true)
  })
  it('is false for another sender', () => {
    expect(resolveIsSelf({ is_send: 0 }, 'wxid_friend', dmCtx)).toBe(false)
  })
})

describe('rowToWxMessage', () => {
  it('maps a received dm text row', () => {
    const message = rowToWxMessage({ local_id: 12, server_id: 99, create_time: 1700, sort_seq: 0, is_send: 0, message_content: 'hello' }, dmCtx)
    expect(message).toMatchObject({ id: 'wx:12:1700012', sessionId: 'wxid_friend', seq: 1_700_012, kind: 'text', text: 'hello', isSelf: false, senderId: 'wxid_friend' })
    expect(message.anchor).toEqual({ sessionId: 'wxid_friend', messageId: 'wx:12:1700012', seq: 1_700_012, createdAt: 1_700_000 })
  })
  it('resolves group sender name and self', () => {
    const groupCtx: MessageRowContext = {
      sessionId: 'room@chatroom',
      isGroup: true,
      selfWxid: 'wxid_me_1a2b',
      resolveName: (u) => (u === 'wxid_bob' ? 'Bob' : undefined),
    }
    const row = { local_id: 1, create_time: 1700, sort_seq: 5, sender_username: 'wxid_bob', message_content: 'wxid_bob:\nhi all' }
    const message = rowToWxMessage(row, groupCtx)
    expect(message.senderId).toBe('wxid_bob')
    expect(message.senderName).toBe('Bob')
    expect(message.text).toBe('hi all')
  })
  it('attaches a quote', () => {
    const row = {
      local_id: 2,
      create_time: 1700,
      sort_seq: 6,
      local_type: 244813135921,
      message_content: '<appmsg><type>57</type><title>my reply</title><refermsg><type>1</type><displayname>Al</displayname><content>orig</content></refermsg></appmsg>',
    }
    const message = rowToWxMessage(row, dmCtx)
    expect(message.kind).toBe('quote')
    expect(message.quote).toEqual({ senderName: 'Al', text: 'orig' })
  })
})

describe('messageIdentityKey', () => {
  it('is stable across shards', () => {
    const a = messageIdentityKey({ serverId: 1, localId: 2, createTime: 3, sortSeq: 4 })
    expect(a).toBe('1-2-3-4')
  })
})

it('does not collide when two shards reuse a local message id', () => {
  const older = rowToWxMessage({ local_id: 125, sort_seq: 1747309846000, create_time: 1747309846, message_content: 'old' }, dmCtx)
  const latest = rowToWxMessage({ local_id: 125, sort_seq: 1788775756000, create_time: 1788775756, message_content: 'new' }, dmCtx)
  expect(older.id).not.toBe(latest.id)
})
