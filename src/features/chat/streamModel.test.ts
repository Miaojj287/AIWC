import { describe, expect, it } from 'vitest'
import type { WxMessage } from '@aiwc/protocol'
import { buildRows, mergeMessages, plainTextOf, rowIndexOfMessage, selectAllState, selectableIds, transcriptOf } from './streamModel'

const msg = (id: string, seq: number, createdAt: number, extra: Partial<WxMessage> = {}): WxMessage => ({
  id,
  sessionId: 's1',
  seq,
  createdAt,
  senderId: 'u1',
  senderName: '张明',
  isSelf: false,
  kind: 'text',
  text: `text ${id}`,
  anchor: { sessionId: 's1', messageId: id, seq, createdAt },
  ...extra,
})

const D1 = new Date(2026, 8, 4, 10).getTime()
const D2 = new Date(2026, 8, 5, 9).getTime()

describe('mergeMessages', () => {
  it('prepends, dedupes by id and keeps seq order', () => {
    const existing = [msg('c', 3, D2), msg('d', 4, D2)]
    const older = [msg('a', 1, D1), msg('b', 2, D1), msg('c', 3, D2)]
    expect(mergeMessages(existing, older, 'prepend').map((m) => m.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('append and replace', () => {
    const existing = [msg('a', 1, D1)]
    expect(mergeMessages(existing, [msg('b', 2, D1)], 'append').map((m) => m.id)).toEqual(['a', 'b'])
    expect(mergeMessages(existing, [msg('z', 9, D2)], 'replace').map((m) => m.id)).toEqual(['z'])
  })
})

describe('buildRows', () => {
  it('inserts one day pill per local day', () => {
    const rows = buildRows([msg('a', 1, D1), msg('b', 2, D1 + 60_000), msg('c', 3, D2)])
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'message', 'day', 'message'])
    expect(rowIndexOfMessage(rows, 'c')).toBe(4)
    expect(rowIndexOfMessage(rows, 'nope')).toBe(-1)
  })
  it('is empty for no messages', () => {
    expect(buildRows([])).toEqual([])
  })
})

describe('plainTextOf / transcriptOf', () => {
  it('formats quotes, voice transcripts and files', () => {
    expect(plainTextOf(msg('q', 1, D1, { kind: 'quote', text: '收到', quote: { senderName: '李娜', text: '看下' } }))).toBe('「李娜：看下」\n收到')
    expect(plainTextOf(msg('v', 2, D1, { kind: 'voice', text: '', media: { kind: 'voice', transcript: '明天见' } }))).toBe('明天见')
    expect(plainTextOf(msg('v2', 2, D1, { kind: 'voice', text: '', media: { kind: 'voice' } }))).toBe('[语音]')
    expect(plainTextOf(msg('f', 3, D1, { kind: 'file', text: '', media: { kind: 'file', fileName: 'a.pdf' } }))).toBe('[文件] a.pdf')
    expect(plainTextOf(msg('i', 4, D1, { kind: 'image', text: '' }))).toBe('[图片]')
  })
  it('writes one line per message with time and sender', () => {
    const t = transcriptOf([msg('a', 1, new Date(2026, 8, 5, 14, 3).getTime()), msg('b', 2, D2, { isSelf: true })])
    expect(t.split('\n')).toEqual(['[2026-09-05 14:03] 张明: text a', '[2026-09-05 09:00] 我: text b'])
  })
})

describe('selection', () => {
  const loaded = [msg('a', 1, D1), msg('s', 2, D1, { kind: 'system', senderId: 'system' }), msg('b', 3, D1)]
  it('ignores system rows when computing 全选', () => {
    expect(selectableIds(loaded)).toEqual(['a', 'b'])
    expect(selectAllState(loaded, new Set())).toBe(false)
    expect(selectAllState(loaded, new Set(['a']))).toBe('indeterminate')
    expect(selectAllState(loaded, new Set(['a', 'b']))).toBe(true)
    expect(selectAllState(loaded, new Set(['zzz']))).toBe(false)
  })
})
