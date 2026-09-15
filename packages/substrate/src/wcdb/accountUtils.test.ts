import { describe, expect, it } from 'vitest'
import {
  buildIdentityKeys,
  classifyContactKind,
  cleanAccountDirName,
  identityMatches,
  shouldKeepSession,
} from './accountUtils'

describe('cleanAccountDirName', () => {
  it('strips 4-char suffixes and keeps wxid stems', () => {
    expect(cleanAccountDirName('wxid_abc123_a1b2')).toBe('wxid_abc123')
    expect(cleanAccountDirName('wxid_abc123')).toBe('wxid_abc123')
    expect(cleanAccountDirName('alias_1a2b')).toBe('alias')
    expect(cleanAccountDirName('plainname')).toBe('plainname')
  })
})

describe('identity matching', () => {
  it('builds identity keys and matches suffixed forms', () => {
    expect(buildIdentityKeys('wxid_me_1a2b')).toEqual(['wxid_me', 'wxid_me_1a2b'])
    expect(identityMatches(buildIdentityKeys('wxid_me_1a2b'), buildIdentityKeys('wxid_me'))).toBe(true)
    expect(identityMatches(['wxid_a'], ['wxid_b'])).toBe(false)
  })
})

describe('classification', () => {
  it('classifies contact kinds and drops system contacts', () => {
    expect(classifyContactKind('room@chatroom', {})).toBe('group')
    expect(classifyContactKind('gh_x', {})).toBe('official')
    expect(classifyContactKind('filehelper', {})).toBeNull()
    expect(classifyContactKind('placeholder_foldgroup', {})).toBeNull()
    expect(classifyContactKind('wxid_friend', { flag: 1 })).toBe('friend')
  })
  it('uses the anchored group rule and the shared system list', () => {
    expect(classifyContactKind('room@im.chatroom', {})).toBe('group')
    expect(classifyContactKind('room@chatroom.example', { flag: 1 })).toBe('friend')
    expect(classifyContactKind('wxapp_demo@app', {})).toBeNull()
    expect(classifyContactKind('my_service_desk', { flag: 1 })).toBe('friend')
  })
})

describe('shouldKeepSession', () => {
  it('keeps normal chats, groups and official accounts', () => {
    expect(shouldKeepSession('wxid_friend')).toBe(true)
    expect(shouldKeepSession('room@chatroom')).toBe(true)
    expect(shouldKeepSession('gh_official')).toBe(true)
  })
  it('drops folders and service accounts', () => {
    expect(shouldKeepSession('@placeholder_foldgroup')).toBe(false)
    expect(shouldKeepSession('brandsessionholder')).toBe(false)
    expect(shouldKeepSession('service_123@kefu.openim')).toBe(false)
    expect(shouldKeepSession('')).toBe(false)
  })
})
