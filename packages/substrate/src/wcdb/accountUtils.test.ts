import { describe, expect, it } from 'vitest'
import {
  buildIdentityKeys,
  classifyContactKind,
  classifySessionKind,
  cleanAccountDirName,
  identityMatches,
  isGroupUsername,
  isOfficialAccountUsername,
  isSystemUsername,
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
  it('classifies session kinds', () => {
    expect(classifySessionKind('123@chatroom')).toBe('group')
    expect(classifySessionKind('gh_news')).toBe('official')
    expect(classifySessionKind('wxid_friend')).toBe('dm')
    expect(classifySessionKind('filehelper')).toBe('system')
  })
  it('classifies contact kinds and drops system contacts', () => {
    expect(classifyContactKind('room@chatroom', {})).toBe('group')
    expect(classifyContactKind('gh_x', {})).toBe('official')
    expect(classifyContactKind('filehelper', {})).toBeNull()
    expect(classifyContactKind('wxid_friend', { flag: 1 })).toBe('friend')
  })
  it('recognises groups and official accounts', () => {
    expect(isGroupUsername('a@chatroom')).toBe(true)
    expect(isOfficialAccountUsername('gh_abc')).toBe(true)
    expect(isSystemUsername('weixin')).toBe(true)
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
