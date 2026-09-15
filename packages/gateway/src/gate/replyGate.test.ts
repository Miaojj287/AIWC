import { describe, expect, it } from 'vitest'
import type { AutoReplyRule } from '@aiwc/protocol'
import { fakeEvent } from '../testing/fakeAdapter'
import { createReplyGate, isSelfSent } from './replyGate'

const rule = (over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: 'r_u_alice',
  sessionId: 'u_alice',
  enabled: true,
  source: 'fixed',
  fixedText: '收到',
  historyCount: 30,
  sendMode: 'auto',
  updatedAt: 0,
  ...over,
})

describe('ReplyGate', () => {
  const gate = createReplyGate()

  it('replies only when the chat has an enabled, unpaused rule', () => {
    expect(gate.decide(fakeEvent(), rule())).toEqual({ reply: true, reason: 'ok' })
  })

  it.each([
    ['self_sent via the reserved peer id', fakeEvent({ source: { peerId: 'me' } })],
    ['self_sent via raw.isSelf', fakeEvent({ raw: { isSelf: true } })],
    ['self_sent via raw.is_self', fakeEvent({ raw: { is_self: true } })],
  ])('drops %s without observing it', (_label, event) => {
    expect(gate.decide(event, rule())).toEqual({ reply: false, reason: 'self_sent', observe: false })
  })

  it.each(['system', 'command'] as const)('drops %s messages without observing them', (kind) => {
    expect(gate.decide(fakeEvent({ kind }), rule())).toEqual({
      reply: false,
      reason: 'kind_not_replyable',
      observe: false,
    })
  })

  it('drops internal events without observing them', () => {
    expect(gate.decide(fakeEvent({ internal: true }), rule())).toEqual({
      reply: false,
      reason: 'internal',
      observe: false,
    })
  })

  it('observes (but does not answer) chats without an active rule', () => {
    expect(gate.decide(fakeEvent())).toEqual({ reply: false, reason: 'no_rule', observe: true })
    expect(gate.decide(fakeEvent(), rule({ enabled: false }))).toEqual({
      reply: false,
      reason: 'rule_disabled',
      observe: true,
    })
    expect(gate.decide(fakeEvent(), rule({ pausedReason: '发送熔断' }))).toEqual({
      reply: false,
      reason: 'rule_paused',
      observe: true,
    })
  })

  it('checks hard drops before the rule, so a self-sent message never replies even with a rule on', () => {
    expect(gate.decide(fakeEvent({ source: { peerId: 'me' }, kind: 'system' }), rule()).reason).toBe('self_sent')
  })

  it('looks the rule up by chat id when none is passed', () => {
    const lookup = createReplyGate({ rules: (chatId) => (chatId === 'u_alice' ? rule() : undefined) })
    expect(lookup.decide(fakeEvent()).reason).toBe('ok')
    expect(lookup.decide(fakeEvent({ source: { chatId: 'u_bob', peerId: 'u_bob' } })).reason).toBe('no_rule')
  })

  it('treats only explicit flags as self-sent', () => {
    expect(isSelfSent(fakeEvent({ raw: { isSelf: 'true' } }))).toBe(false)
    expect(isSelfSent(fakeEvent())).toBe(false)
  })
})
