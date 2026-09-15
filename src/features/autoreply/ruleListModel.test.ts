import { describe, expect, it } from 'vitest'
import type { AutoReplyRule, WxSession } from '@aiwc/protocol'
import { buildRuleRows, sessionMatchesQuery, type RuleRowsInput } from './ruleListModel'
import { newRule } from './ruleModel'

const session = (id: string, patch: Partial<WxSession> = {}): WxSession => ({
  id,
  kind: 'dm',
  title: `Chat ${id}`,
  unread: 0,
  pinned: false,
  muted: false,
  lastMessageAt: 0,
  ...patch,
})

const rule = (sessionId: string, patch: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  ...newRule(sessionId),
  id: `rule_${sessionId}`,
  ...patch,
})

const input = (patch: Partial<RuleRowsInput>): RuleRowsInput => ({
  rules: [],
  ruleSessions: new Map(),
  pageSessions: [],
  query: '',
  segment: 'all',
  parked: new Map(),
  ...patch,
})

const ids = (rows: ReturnType<typeof buildRuleRows>) => rows.map((r) => r.session.id)

describe('buildRuleRows', () => {
  it('lists a rule whose chat is not in the loaded pages, from the resolved session', () => {
    const rows = buildRuleRows(
      input({
        rules: [rule('far')],
        ruleSessions: new Map([['far', session('far')]]),
        pageSessions: [session('a'), session('b')],
      }),
    )
    expect(ids(rows)).toEqual(['far', 'a', 'b'])
    expect(rows[0]?.rule?.id).toBe('rule_far')
    expect(rows[1]?.rule).toBeUndefined()
  })

  it('never lists a chat twice and prefers the fresher page copy', () => {
    const rows = buildRuleRows(
      input({
        rules: [rule('a')],
        ruleSessions: new Map([['a', session('a', { title: 'old title' })]]),
        pageSessions: [session('a', { title: 'new title' }), session('b')],
      }),
    )
    expect(ids(rows)).toEqual(['a', 'b'])
    expect(rows[0]?.session.title).toBe('new title')
  })

  it('orders parked replies first, then on, paused, and recency; unset chats keep the substrate order', () => {
    const rows = buildRuleRows(
      input({
        rules: [rule('paused', { enabled: false }), rule('on-old'), rule('on-new'), rule('parked', { enabled: false })],
        ruleSessions: new Map([
          ['paused', session('paused', { lastMessageAt: 50 })],
          ['on-old', session('on-old', { lastMessageAt: 10 })],
          ['on-new', session('on-new', { lastMessageAt: 20 })],
          ['parked', session('parked')],
        ]),
        pageSessions: [session('pinned', { lastMessageAt: 1 }), session('recent', { lastMessageAt: 99 })],
        parked: new Map([['parked', 2]]),
      }),
    )
    expect(ids(rows)).toEqual(['parked', 'on-new', 'on-old', 'paused', 'pinned', 'recent'])
  })

  it('keeps only rule rows of the segment in 已开启 / 已暂停', () => {
    const base = input({
      rules: [rule('on'), rule('off', { enabled: false })],
      ruleSessions: new Map([
        ['on', session('on')],
        ['off', session('off')],
      ]),
      pageSessions: [session('plain')],
    })
    expect(ids(buildRuleRows({ ...base, segment: 'on' }))).toEqual(['on'])
    expect(ids(buildRuleRows({ ...base, segment: 'paused' }))).toEqual(['off'])
  })

  it('filters resolved rule chats by the query; chats the backend matched stay', () => {
    const rows = buildRuleRows(
      input({
        rules: [rule('x'), rule('y'), rule('z')],
        ruleSessions: new Map([
          ['x', session('x', { title: 'Weekly sync' })],
          ['y', session('y', { title: 'Family' })],
          ['z', session('z', { title: 'Z', lastPreview: 'see you at the sync' })],
        ]),
        // the backend matched `y` on a field the renderer does not see
        pageSessions: [session('y', { title: 'Family' })],
        query: 'SYNC',
      }),
    )
    expect(ids(rows).sort()).toEqual(['x', 'y', 'z'])
    expect(
      ids(buildRuleRows(input({ rules: [rule('y')], ruleSessions: new Map([['y', session('y')]]), query: 'sync' }))),
    ).toEqual([])
  })

  it('skips official accounts and rules whose chat cannot be resolved', () => {
    const rows = buildRuleRows(
      input({
        rules: [rule('gone'), rule('gh_news')],
        ruleSessions: new Map([['gh_news', session('gh_news', { kind: 'official' })]]),
        pageSessions: [session('gh_other', { kind: 'official' }), session('room@chatroom', { kind: 'group' })],
      }),
    )
    expect(ids(rows)).toEqual(['room@chatroom'])
  })
})

describe('sessionMatchesQuery', () => {
  it('matches title, id or last preview, case-insensitively; an empty query matches all', () => {
    const s = session('wxid_Alpha', { title: '产品群', lastPreview: 'Launch Plan' })
    expect(sessionMatchesQuery(s, '')).toBe(true)
    expect(sessionMatchesQuery(s, '产品')).toBe(true)
    expect(sessionMatchesQuery(s, 'alpha')).toBe(true)
    expect(sessionMatchesQuery(s, 'launch plan')).toBe(true)
    expect(sessionMatchesQuery(s, 'budget')).toBe(false)
  })
})
