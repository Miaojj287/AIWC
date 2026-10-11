import { describe, expect, it } from 'vitest'
import { fakeEvent } from '../testing/fakeAdapter'
import { checkOwnerMessage, maskId } from './ownerGate'

const OWNER = 'owner_user_1'
const fromOwner = fakeEvent({ source: { peerId: OWNER, chatId: OWNER, chatType: 'dm' } })

describe('checkOwnerMessage', () => {
  it('accepts the owner in the private chat on the iLink channel', () => {
    expect(checkOwnerMessage(fromOwner, OWNER)).toEqual({ ok: true })
    expect(checkOwnerMessage(fromOwner, ` ${OWNER} `)).toEqual({ ok: true })
  })

  it('refuses everything while no owner is bound', () => {
    expect(checkOwnerMessage(fromOwner, undefined)).toEqual({ ok: false, reason: 'no_owner' })
    expect(checkOwnerMessage(fromOwner, '  ')).toEqual({ ok: false, reason: 'no_owner' })
  })

  it('refuses other people', () => {
    const other = fakeEvent({ source: { peerId: 'u_alice', chatId: 'u_alice', chatType: 'dm' } })
    expect(checkOwnerMessage(other, OWNER)).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('refuses the owner inside a group, even when the group id equals the owner id', () => {
    const group = fakeEvent({ source: { peerId: OWNER, chatId: 'room@chatroom', chatType: 'group' } })
    expect(checkOwnerMessage(group, OWNER)).toEqual({ ok: false, reason: 'group' })
    const forged = fakeEvent({ source: { peerId: OWNER, chatId: OWNER, chatType: 'group' } })
    expect(checkOwnerMessage(forged, OWNER)).toEqual({ ok: false, reason: 'group' })
  })

  it('refuses a dm whose chat id and peer id disagree', () => {
    const mixed = fakeEvent({ source: { peerId: OWNER, chatId: 'u_alice', chatType: 'dm' } })
    expect(checkOwnerMessage(mixed, OWNER)).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('refuses other channels and synthetic events', () => {
    const desktop = fakeEvent({ source: { channel: 'desktop', peerId: OWNER, chatId: OWNER } })
    expect(checkOwnerMessage(desktop, OWNER)).toEqual({ ok: false, reason: 'wrong_channel' })
    const local = fakeEvent({ source: { channel: 'wechat-ui', peerId: OWNER, chatId: OWNER } })
    expect(checkOwnerMessage(local, OWNER)).toEqual({ ok: false, reason: 'wrong_channel' })
    const internal = { ...fromOwner, internal: true }
    expect(checkOwnerMessage(internal, OWNER)).toEqual({ ok: false, reason: 'internal' })
  })
})

describe('maskId', () => {
  it('keeps only the ends', () => {
    expect(maskId('owner_user_12345')).toBe('owne…2345')
    expect(maskId('abc')).toBe('ab…')
  })
})
