import { describe, expect, it } from 'vitest'
import type { ReplyDraft } from '@aiwc/protocol'
import { initialReplyDeskState, pendingCount, remainingMs, replyDeskReducer, type ReplyDeskState } from './reducer'

const draft = (id: string, patch: Partial<ReplyDraft> = {}): ReplyDraft => ({
  id,
  source: { channel: 'wechat-ui', peerId: 'p', chatId: 'c', chatType: 'dm', displayName: '李娜' },
  triggerMessageId: `m-${id}`,
  triggerText: '报价单能再发一份吗',
  draft: '收到，稍后发你',
  state: 'pending',
  createdAt: Number(id.replace(/\D/g, '')) || 0,
  mode: 'confirm',
  ...patch,
})

const run = (actions: Parameters<typeof replyDeskReducer>[1][], start: ReplyDeskState = initialReplyDeskState) => actions.reduce(replyDeskReducer, start)

describe('replyDeskReducer', () => {
  it('loads pending drafts oldest first and marks loaded', () => {
    const s = run([{ type: 'loaded', drafts: [draft('d3'), draft('d1'), draft('d2', { state: 'sent' })] }])
    expect(s.loaded).toBe(true)
    expect(s.drafts.map((d) => d.id)).toEqual(['d1', 'd3'])
  })

  it('upserts pending drafts and removes resolved ones', () => {
    let s = run([{ type: 'draft', draft: draft('d1') }, { type: 'draft', draft: draft('d2', { mode: 'auto', countdownEndsAt: 5000 }) }])
    expect(pendingCount(s)).toBe(2)
    s = replyDeskReducer(s, { type: 'draft', draft: draft('d1', { draft: '改过的文案' }) })
    expect(s.drafts.find((d) => d.id === 'd1')?.draft).toBe('改过的文案')
    expect(s.drafts).toHaveLength(2)
    s = replyDeskReducer(s, { type: 'draft', draft: draft('d1', { state: 'sent' }) })
    expect(s.drafts.map((d) => d.id)).toEqual(['d2'])
    s = replyDeskReducer(s, { type: 'draft', draft: draft('d2', { state: 'expired' }) })
    expect(s.drafts).toHaveLength(0)
  })

  it('keeps failed drafts until dismissed and they do not count as pending', () => {
    let s = run([{ type: 'draft', draft: draft('d1') }, { type: 'draft', draft: draft('d1', { state: 'failed', error: '通道已熔断' }) }])
    expect(s.drafts).toHaveLength(1)
    expect(pendingCount(s)).toBe(0)
    // a reload from the backend (pending only) keeps the failed one
    s = replyDeskReducer(s, { type: 'loaded', drafts: [draft('d2')] })
    expect(s.drafts.map((d) => d.id)).toEqual(['d1', 'd2'])
    s = replyDeskReducer(s, { type: 'dismiss', draftId: 'd1' })
    expect(s.drafts.map((d) => d.id)).toEqual(['d2'])
  })

  it('tracks countdowns only for known drafts and clears them on resolve', () => {
    let s = run([{ type: 'draft', draft: draft('d1', { mode: 'auto', countdownEndsAt: 10_000 }) }])
    s = replyDeskReducer(s, { type: 'countdown', draftId: 'nope', remainingMs: 100 })
    expect(s.countdowns).toEqual({})
    s = replyDeskReducer(s, { type: 'countdown', draftId: 'd1', remainingMs: 3200 })
    expect(remainingMs(s, s.drafts[0]!, 0)).toBe(3200)
    s = replyDeskReducer(s, { type: 'countdown', draftId: 'd1', remainingMs: -5 })
    expect(s.countdowns.d1).toBe(0)
    s = replyDeskReducer(s, { type: 'draft', draft: draft('d1', { state: 'sent' }) })
    expect(s.countdowns).toEqual({})
  })

  it('falls back to countdownEndsAt when no live countdown arrived', () => {
    const s = run([{ type: 'draft', draft: draft('d1', { mode: 'auto', countdownEndsAt: 10_000 }) }])
    expect(remainingMs(s, s.drafts[0]!, 4_000)).toBe(6_000)
    expect(remainingMs(s, s.drafts[0]!, 40_000)).toBe(0)
    expect(remainingMs(s, draft('x', { mode: 'confirm' }), 0)).toBeUndefined()
  })

  it('latches and releases the halt', () => {
    let s = run([{ type: 'halted', reason: 'DB 读回校验失败' }])
    expect(s.halted).toBe('DB 读回校验失败')
    s = replyDeskReducer(s, { type: 'resumed' })
    expect(s.halted).toBeNull()
  })

  it('records load failures without dropping known drafts', () => {
    const s = run([{ type: 'draft', draft: draft('d1') }, { type: 'load_failed', error: 'offline' }])
    expect(s.loaded).toBe(true)
    expect(s.error).toBe('offline')
    expect(s.drafts).toHaveLength(1)
  })
})
