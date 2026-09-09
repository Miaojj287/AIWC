import { describe, expect, it } from 'vitest'
import type { MessageEvent } from '@aiwc/protocol'
import { estimateTokens } from '@aiwc/protocol'
import { createObservedBuffer, formatObservedLine, OBSERVED_FRAGMENT_MARKER, OBSERVED_FRAGMENT_TOKEN_CAP, renderObservedLines } from './observedBuffer'

const ev = (i: number, over: Partial<MessageEvent> = {}, ts = 1_000_000 + i): MessageEvent => ({
  id: `m${i}`,
  kind: 'text',
  text: `msg ${i}`,
  timestamp: ts,
  addressed: false,
  source: { channel: 'wechat-ilink', peerId: `u${i % 3}`, chatId: 'g1', chatType: 'group', displayName: `User${i % 3}` },
  ...over,
})

describe('observed buffer', () => {
  it('formats attribution as [sender|peerId] text', () => {
    expect(formatObservedLine(ev(1))).toBe('[User1|u1] msg 1')
    expect(formatObservedLine(ev(2, { source: { channel: 'wechat-ilink', peerId: 'u9', chatId: 'g1', chatType: 'group' }, text: 'a\n b' }))).toBe('[u9|u9] a b')
  })

  it('keeps at most `max` entries per chat, dropping the oldest', () => {
    const buf = createObservedBuffer({ max: 3, now: () => 2_000_000 })
    for (let i = 0; i < 5; i++) buf.push(ev(i))
    expect(buf.peek('g1').map((e) => e.id)).toEqual(['m2', 'm3', 'm4'])
    expect(buf.size('g1')).toBe(3)
  })

  it('ignores addressed and empty messages', () => {
    const buf = createObservedBuffer({ now: () => 2_000_000 })
    expect(buf.push(ev(1, { addressed: true }))).toBe(false)
    expect(buf.push(ev(2, { text: '   ' }))).toBe(false)
    expect(buf.size('g1')).toBe(0)
  })

  it('expires entries older than the TTL, measured from receive time', () => {
    let now = 9_500
    const buf = createObservedBuffer({ ttlMs: 1_000, now: () => now })
    buf.push(ev(1, {}, 1)) // skewed event timestamp must not matter
    now = 9_900
    buf.push(ev(2, {}, 9_900))
    expect(buf.size('g1')).toBe(2)
    now = 10_600
    expect(buf.peek('g1').map((e) => e.id)).toEqual(['m2'])
    now = 11_000
    expect(buf.size('g1')).toBe(0)
    expect(buf.fragment('g1')).toBeUndefined()
  })

  it('take drains the most recent N (oldest first) and leaves the rest', () => {
    const buf = createObservedBuffer({ now: () => 2_000_000 })
    for (let i = 0; i < 5; i++) buf.push(ev(i))
    expect(buf.take('g1', 2).map((e) => e.id)).toEqual(['m3', 'm4'])
    expect(buf.peek('g1').map((e) => e.id)).toEqual(['m0', 'm1', 'm2'])
    expect(buf.take('g1').map((e) => e.id)).toEqual(['m0', 'm1', 'm2'])
    expect(buf.size('g1')).toBe(0)
    expect(buf.take('nope')).toEqual([])
  })

  it('isolates chats', () => {
    const buf = createObservedBuffer({ now: () => 2_000_000 })
    buf.push(ev(1))
    buf.push(ev(2, { source: { channel: 'wechat-ilink', peerId: 'u1', chatId: 'g2', chatType: 'group' } }))
    expect(buf.size('g1')).toBe(1)
    expect(buf.size('g2')).toBe(1)
    buf.clear('g1')
    expect(buf.size('g1')).toBe(0)
    expect(buf.size('g2')).toBe(1)
  })

  it('renders a bounded fragment with marker, preamble and attribution lines', () => {
    const buf = createObservedBuffer({ now: () => 2_000_000 })
    buf.push(ev(1))
    buf.push(ev(2))
    const frag = buf.fragment('g1')
    expect(frag).toBeDefined()
    expect(frag?.kind).toBe('observed_context')
    expect(frag?.marker).toBe(OBSERVED_FRAGMENT_MARKER)
    expect(frag?.tokenCap).toBe(1500)
    const text = frag!.render()
    expect(text.startsWith(`${OBSERVED_FRAGMENT_MARKER}\n`)).toBe(true)
    expect(text).toContain('未点名你')
    expect(text).toContain('[User1|u1] msg 1\n[User2|u2] msg 2')
    expect(text.trimEnd().endsWith('</observed_context>')).toBe(true)
    // fragment is a snapshot: draining afterwards does not change what it renders
    buf.take('g1')
    expect(frag!.render()).toBe(text)
  })

  it('caps the rendered fragment at tokenCap by dropping oldest lines first', () => {
    const lines: string[] = []
    for (let i = 0; i < 40; i++) lines.push(`[User|u] ${'这是一条很长的群聊消息用来撑爆上下文预算'.repeat(6)} #${i}`)
    const text = renderObservedLines(lines, OBSERVED_FRAGMENT_TOKEN_CAP)
    expect(estimateTokens(text)).toBeLessThanOrEqual(OBSERVED_FRAGMENT_TOKEN_CAP)
    expect(text).toContain('#39')
    expect(text).not.toContain('#0\n')
  })

  it('still emits a truncated tail when a single line exceeds the cap', () => {
    const text = renderObservedLines([`[U|u] ${'超'.repeat(5000)}`], 100)
    expect(estimateTokens(text)).toBeLessThanOrEqual(160)
    expect(text).toContain('[U|u] 超')
    expect(text).toContain('已截断') // cut by the protocol-wide truncateToTokens, never a silent slice
  })
})
