import { describe, expect, it } from 'vitest'
import { clampLimit, compactMessage, describeCoverage, fmtTime, messageText, squash, toJson } from './shared'
import { createFakeSubstrate, msg } from './testing/fakeSubstrate'

const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/

describe('clampLimit', () => {
  it('falls back to the default and clamps into range', () => {
    expect(clampLimit(undefined, 20, 50)).toBe(20)
    expect(clampLimit(null, 20, 50)).toBe(20)
    expect(clampLimit(Number.NaN, 20, 50)).toBe(20)
    expect(clampLimit(999, 20, 50)).toBe(50)
    expect(clampLimit(0, 20, 50)).toBe(1)
    expect(clampLimit(7.9, 20, 50)).toBe(7)
  })
})

describe('fmtTime / squash', () => {
  it('formats millis as local YYYY-MM-DD HH:mm and rejects invalid input', () => {
    expect(fmtTime(Date.UTC(2026, 0, 10, 4, 0))).toMatch(TIME_RE)
    expect(fmtTime(undefined)).toBeNull()
    expect(fmtTime(0)).toBeNull()
    expect(fmtTime(Number.NaN)).toBeNull()
  })
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(squash('  a \n b\t c ', 100)).toBe('a b c')
    expect(squash('x'.repeat(300), 200)).toHaveLength(200)
    expect(squash('x'.repeat(300), 200).endsWith('…')).toBe(true)
    expect(squash(undefined, 10)).toBe('')
  })
})

describe('compactMessage', () => {
  it('keeps the anchor, marks self as 我, caps text at 200 chars', () => {
    const m = msg({ id: 'a', sessionId: 's', seq: 3, isSelf: true, senderId: 'me', text: '好'.repeat(400) })
    const c = compactMessage(m)
    expect(c.anchor).toEqual({ sessionId: 's', messageId: 'a', seq: 3, createdAt: m.createdAt })
    expect(c.senderName).toBe('我')
    expect(c.isSelf).toBe(true)
    expect(c.text).toHaveLength(200)
    expect(c.time).toMatch(TIME_RE)
    expect(c.kind).toBe('text')
    expect(c.media).toBeUndefined()
  })
  it('uses senderName, then senderId for others', () => {
    expect(compactMessage(msg({ id: 'a', sessionId: 's', seq: 1, senderId: 'u1', senderName: '阿明', text: 'x' })).senderName).toBe('阿明')
    expect(compactMessage(msg({ id: 'a', sessionId: 's', seq: 1, senderId: 'u1', text: 'x' })).senderName).toBe('u1')
  })
  it('renders media placeholders without paths or bytes', () => {
    const voice = compactMessage(msg({ id: 'v', sessionId: 's', seq: 1, kind: 'voice', media: { kind: 'voice', durationMs: 4200, path: '/secret/voice.silk' } }))
    expect(voice.text).toBe('[语音 4s]')
    expect(voice.media).toEqual({ kind: 'voice', durationMs: 4200 })
    expect(JSON.stringify(voice)).not.toContain('/secret')

    const voiceT = compactMessage(msg({ id: 'v', sessionId: 's', seq: 1, kind: 'voice', media: { kind: 'voice', transcript: '明天见' } }))
    expect(voiceT.text).toBe('[语音] 明天见')
    expect(voiceT.media?.hasTranscript).toBe(true)

    const file = compactMessage(msg({ id: 'f', sessionId: 's', seq: 1, kind: 'file', media: { kind: 'file', fileName: '预算.xlsx', sizeBytes: 10, path: '/x' } }))
    expect(file.text).toBe('[文件] 预算.xlsx')
    expect(file.media).toEqual({ kind: 'file', fileName: '预算.xlsx', sizeBytes: 10 })

    expect(compactMessage(msg({ id: 'i', sessionId: 's', seq: 1, kind: 'image' })).text).toBe('[图片]')
    expect(compactMessage(msg({ id: 'r', sessionId: 's', seq: 1, kind: 'revoke' })).text).toBe('[消息已撤回]')
    expect(compactMessage(msg({ id: 'k', sessionId: 's', seq: 1, kind: 'sticker' })).text).toBe('[表情]')
  })
  it('keeps a bounded quote', () => {
    const c = compactMessage(msg({ id: 'q', sessionId: 's', seq: 1, kind: 'quote', text: '回复', quote: { senderName: '小红', text: 'y'.repeat(200) } }))
    expect(c.quote?.senderName).toBe('小红')
    expect(c.quote?.text).toHaveLength(80)
  })
  it('describes messageText for link/card/location/transfer kinds', () => {
    expect(messageText(msg({ id: 'l', sessionId: 's', seq: 1, kind: 'link', text: '文章标题' }))).toBe('[链接] 文章标题')
    expect(messageText(msg({ id: 'l', sessionId: 's', seq: 1, kind: 'link' }))).toBe('[链接]')
    expect(messageText(msg({ id: 't', sessionId: 's', seq: 1, kind: 'transfer', text: '¥100' }))).toBe('[转账] ¥100')
  })
})

describe('describeCoverage', () => {
  it('describes a session-scoped search as unbounded and a global one as bounded', () => {
    const sub = createFakeSubstrate({ sync: { totals: { sessions: 2, messages: 1234, media: 0 } } })
    const scoped = describeCoverage(sub, { sessionIds: ['a', 'b'], from: Date.UTC(2026, 0, 1) })
    expect(scoped.scope).toBe('sessions')
    expect(scoped.bounded).toBe(false)
    expect(scoped.sessionCount).toBe(2)
    expect(scoped.from).toMatch(TIME_RE)
    expect(scoped.note).toContain('2 个会话')

    const global = describeCoverage(sub, {})
    expect(global.scope).toBe('all_indexed')
    expect(global.bounded).toBe(true)
    expect(global.indexedMessages).toBe(1234)
    expect(global.note).toContain('1234')
    expect(global.note).toContain('sessionIds')
  })
  it('mentions an in-progress sync', () => {
    const sub = createFakeSubstrate({ sync: { phase: 'syncing' } })
    expect(describeCoverage(sub, {}).note).toContain('同步中')
  })
})

describe('toJson', () => {
  it('strips undefined and stringifies bigint', () => {
    expect(toJson({ a: undefined, b: 1n, c: [undefined, 2] })).toEqual({ b: '1', c: [null, 2] })
    expect(toJson(undefined)).toBeNull()
  })
})
