import { describe, expect, it } from 'vitest'
import { groupMemberRanking, groupMembers, listGroups } from './groups'
import { listContacts } from './listContacts'
import { listSessions } from './listSessions'
import { body, runTool } from './testing/ctx'
import { contact, sampleWorld } from './testing/fakeSubstrate'

describe('list_sessions', () => {
  it('returns compact sessions newest-first with defaults applied', async () => {
    const sub = sampleWorld()
    const res = await runTool(listSessions, {}, sub)
    expect(res.isError).toBeUndefined()
    const out = body(res)
    expect(out.sessions.map((s: { id: string }) => s.id)).toEqual(['grp_1@chatroom', 'user_a', 'gh_news'])
    expect(out.sessions[0]).toMatchObject({ id: 'grp_1@chatroom', kind: 'group', title: '项目组', unread: 0, memberCount: 3 })
    expect(out.sessions[0].lastMessageAt).toBeTypeOf('number')
    expect(out.sessions[0].time).toMatch(/^\d{4}-/)
    expect(out.total).toBe(3)
    expect(sub.calls[0]).toEqual({ method: 'listSessions', args: [{ limit: 20, kind: 'all' }] })
  })
  it('filters by kind and query', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(listSessions, { kind: 'dm', query: '阿明', limit: 5 }, sub))
    expect(out.sessions).toHaveLength(1)
    expect(out.sessions[0].id).toBe('user_a')
    expect(body(await runTool(listSessions, { query: '不存在' }, sub)).note).toContain('不存在')
  })
  it('rejects limits above 50 and unknown kinds', () => {
    expect(listSessions.inputSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(listSessions.inputSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listSessions.inputSchema.safeParse({ kind: 'bot' }).success).toBe(false)
    expect(listSessions.inputSchema.safeParse({ limit: 50 }).success).toBe(true)
  })
})

describe('list_contacts', () => {
  it('resolves a name to usernames with nickname / remark / kind', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(listContacts, { query: '阿明' }, sub))
    expect(out.contacts).toEqual([{ username: 'user_a', nickname: '阿明', remark: '同事阿明', kind: 'friend' }])
    expect(out.total).toBe(1)
    expect(sub.calls[0]).toEqual({ method: 'listContacts', args: [{ query: '阿明', kind: 'all', limit: 10 }] })
  })
  it('matches on remark too and reports no-result', async () => {
    const sub = sampleWorld()
    expect(body(await runTool(listContacts, { query: '同事' }, sub)).contacts[0].username).toBe('user_a')
    expect(body(await runTool(listContacts, { query: 'zzz' }, sub)).note).toContain('zzz')
  })
  it('requires a non-empty query and caps limit at 30', () => {
    expect(listContacts.inputSchema.safeParse({}).success).toBe(false)
    expect(listContacts.inputSchema.safeParse({ query: '   ' }).success).toBe(false)
    expect(listContacts.inputSchema.safeParse({ query: 'a', limit: 31 }).success).toBe(false)
    expect(listContacts.inputSchema.safeParse({ query: 'a', limit: 30 }).success).toBe(true)
  })
})

describe('list_groups', () => {
  it('lists group sessions only, with member counts', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(listGroups, {}, sub))
    expect(out.groups).toHaveLength(1)
    expect(out.groups[0]).toMatchObject({ id: 'grp_1@chatroom', kind: 'group', memberCount: 3 })
    expect(sub.calls[0]).toEqual({ method: 'listSessions', args: [{ kind: 'group', limit: 20 }] })
  })
  it('supplements from group contacts that have no session when a query is given', async () => {
    const sub = sampleWorld()
    sub.data.contacts.push(contact({ username: 'grp_2@chatroom', nickname: '读书会', lastContactAt: 1 }))
    const out = body(await runTool(listGroups, { query: '读书' }, sub))
    expect(out.groups.map((g: { id: string }) => g.id)).toEqual(['grp_2@chatroom'])
    expect(out.groups[0].title).toBe('读书会')
    expect(out.note).toContain('通讯录')
  })
  it('caps limit at 30', () => {
    expect(listGroups.inputSchema.safeParse({ limit: 31 }).success).toBe(false)
  })
})

describe('group_members', () => {
  it('returns the roster compactly', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(groupMembers, { groupId: 'grp_1@chatroom' }, sub))
    expect(out.total).toBe(3)
    expect(out.hasMore).toBe(false)
    expect(out.members).toEqual([
      { username: 'user_a', nickname: '阿明', remark: '同事阿明', kind: 'friend' },
      { username: 'user_b', nickname: '小红', kind: 'friend' },
      { username: 'me', nickname: '我自己', kind: 'friend' },
    ])
    expect(sub.calls[0]).toEqual({ method: 'listGroupMembers', args: ['grp_1@chatroom', { limit: 100 }] })
  })
  it('honours limit and flags non-group ids', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(groupMembers, { groupId: 'grp_1@chatroom', limit: 2 }, sub))
    expect(out.members).toHaveLength(2)
    expect(out.hasMore).toBe(true)
    expect(body(await runTool(groupMembers, { groupId: 'user_a' }, sub)).note).toContain('@chatroom')
  })
  it('validates groupId and limit', () => {
    expect(groupMembers.inputSchema.safeParse({}).success).toBe(false)
    expect(groupMembers.inputSchema.safeParse({ groupId: 'g@chatroom', limit: 201 }).success).toBe(false)
  })
})

describe('group_member_ranking', () => {
  it('forwards a ranking stats query scoped to the group and ranks rows', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(groupMemberRanking, { groupId: 'grp_1@chatroom', limit: 5 }, sub))
    expect(sub.calls[0]).toEqual({ method: 'stats', args: [{ metric: 'ranking', sessionId: 'grp_1@chatroom', limit: 5 }] })
    expect(out.rows[0]).toMatchObject({ rank: 1, id: 'user_b', name: '小红', messageCount: 3 })
    expect(out.rows[1]).toMatchObject({ rank: 2, id: 'user_a', messageCount: 1 })
    expect(out.total).toBe(2)
  })
  it('passes the time range through', async () => {
    const sub = sampleWorld()
    await runTool(groupMemberRanking, { groupId: 'grp_1@chatroom', from: 1, to: 2 }, sub)
    expect(sub.calls[0]?.args[0]).toMatchObject({ from: 1, to: 2 })
  })
  it('rejects from > to and limit > 30', () => {
    expect(groupMemberRanking.inputSchema.safeParse({ groupId: 'g@chatroom', from: 5, to: 1 }).success).toBe(false)
    expect(groupMemberRanking.inputSchema.safeParse({ groupId: 'g@chatroom', limit: 31 }).success).toBe(false)
  })
})
