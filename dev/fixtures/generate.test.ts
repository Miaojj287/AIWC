import { describe, expect, it } from 'vitest'
import { generateDataset, DEFAULT_SEED } from './generate.ts'
import { FORBIDDEN_NAMES } from './corpus.ts'

const NOW = Date.UTC(2026, 8, 6, 1, 0, 0)

describe('demo dataset generator', () => {
  const fixture = generateDataset({ seed: DEFAULT_SEED, now: NOW })

  it('is deterministic for the same seed', () => {
    const again = generateDataset({ seed: DEFAULT_SEED, now: NOW })
    expect(again.account.wxid).toBe(fixture.account.wxid)
    expect(again.sessions.slice(0, 5).map((s) => s.id)).toEqual(fixture.sessions.slice(0, 5).map((s) => s.id))
    expect(again.contacts.slice(0, 5).map((c) => c.username)).toEqual(fixture.contacts.slice(0, 5).map((c) => c.username))
    expect(again.messages.slice(0, 5).map((m) => m.id)).toEqual(fixture.messages.slice(0, 5).map((m) => m.id))
    expect(JSON.stringify(again)).toBe(JSON.stringify(fixture))
  })

  it('changes with the seed', () => {
    const other = generateDataset({ seed: DEFAULT_SEED + 1, now: NOW })
    expect(other.account.wxid).not.toBe(fixture.account.wxid)
    expect(other.contacts.slice(0, 5).map((c) => c.username)).not.toEqual(fixture.contacts.slice(0, 5).map((c) => c.username))
  })

  it('has the requested shape', () => {
    expect(fixture.version).toBe(1)
    expect(fixture.account.verified).toBe(true)
    expect(fixture.sessions.filter((s) => s.kind === 'dm')).toHaveLength(26)
    expect(fixture.sessions.filter((s) => s.kind === 'group')).toHaveLength(14)
    expect(fixture.contacts).toHaveLength(60)
    expect(fixture.messages.length).toBeGreaterThan(5000)
    expect(fixture.messages.length).toBeLessThan(7500)
    expect(Object.keys(fixture.groupMembers)).toHaveLength(14)
    for (const s of fixture.sessions.filter((s) => s.kind === 'group')) {
      expect(fixture.groupMembers[s.id]).toContain(fixture.account.wxid)
      expect(s.memberCount).toBe(fixture.groupMembers[s.id]?.length)
    }
    expect(Buffer.byteLength(JSON.stringify(fixture))).toBeLessThan(3 * 1024 * 1024)
  })

  it('keeps seq strictly increasing and chronological inside each session', () => {
    const bySession = new Map<string, typeof fixture.messages>()
    for (const m of fixture.messages) bySession.set(m.sessionId, [...(bySession.get(m.sessionId) ?? []), m])
    for (const list of bySession.values()) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.seq).toBeGreaterThan(list[i - 1]!.seq)
        expect(list[i]!.createdAt).toBeGreaterThanOrEqual(list[i - 1]!.createdAt)
      }
    }
    expect(new Set(fixture.messages.map((m) => m.id)).size).toBe(fixture.messages.length)
    for (const m of fixture.messages) expect(m.anchor).toEqual({ sessionId: m.sessionId, messageId: m.id, seq: m.seq, createdAt: m.createdAt })
  })

  it('spans the last 90 days with a realistic kind mix', () => {
    const times = fixture.messages.map((m) => m.createdAt)
    expect(Math.max(...times)).toBeLessThan(NOW)
    expect(Math.min(...times)).toBeGreaterThan(NOW - 91 * 86_400_000)
    const text = fixture.messages.filter((m) => m.kind === 'text').length / fixture.messages.length
    expect(text).toBeGreaterThan(0.8)
    expect(text).toBeLessThan(0.9)
    const kinds = new Set(fixture.messages.map((m) => m.kind))
    for (const k of ['image', 'voice', 'file', 'sticker', 'system', 'quote']) expect(kinds.has(k as never)).toBe(true)
    const voice = fixture.messages.filter((m) => m.kind === 'voice')
    expect(voice.every((m) => (m.media?.durationMs ?? 0) > 0)).toBe(true)
    expect(voice.some((m) => m.media?.transcript)).toBe(true)
    expect(fixture.messages.filter((m) => m.kind === 'quote').every((m) => m.quote?.text)).toBe(true)
  })

  it('derives session fields and never uses mock names', () => {
    for (const s of fixture.sessions) {
      expect(s.lastMessageAt).toBeGreaterThan(0)
      expect(s.lastPreview).toBeTruthy()
      expect(s.indexedCount).toBeGreaterThan(0)
    }
    expect(fixture.sessions.filter((s) => s.pinned).length).toBeGreaterThan(0)
    expect(fixture.sessions.filter((s) => s.muted).length).toBeGreaterThan(0)
    expect(fixture.sessions.some((s) => s.unread > 0)).toBe(true)
    for (const c of fixture.contacts) expect(FORBIDDEN_NAMES.has(c.nickname)).toBe(false)
    const groupSenders = fixture.sessions
      .filter((s) => s.kind === 'group')
      .map((s) => new Set(fixture.messages.filter((m) => m.sessionId === s.id && m.senderId !== 'system').map((m) => m.senderId)).size)
    for (const n of groupSenders) expect(n).toBeGreaterThanOrEqual(3)
  })
})
