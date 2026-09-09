/**
 * wechat-bot scoping: every read tool mounted on the bot is confined to ctx.origin.chatId, and the
 * enumeration / cross-session tools refuse the bot outright. A bot reply is auto-sent to the peer,
 * so none of these may leak another conversation or the owner's contact graph.
 */
import { describe, expect, it } from 'vitest'
import { BOT_NO_ORIGIN_MESSAGE, BOT_TOOL_REFUSED_MESSAGE, botOriginChatId, isBotContext, refuseForBot, scopeBotSession, scopeBotSessions } from './botScope'
import { chatStats } from './chatStats'
import { getContext } from './getContext'
import { getTimeline } from './getTimeline'
import { groupMemberRanking, groupMembers, listGroups } from './groups'
import { listContacts } from './listContacts'
import { listSessions } from './listSessions'
import { searchMessages, semanticSearch } from './search'
import { searchMedia } from './searchMedia'
import { body, botCtxOverrides, makeCtx, runTool } from './testing/ctx'
import { T0, sampleWorld } from './testing/fakeSubstrate'

const DM = 'user_a'
const GROUP = 'grp_1@chatroom'
const bot = botCtxOverrides
const anchorIn = (sessionId: string, messageId: string, seq: number) => ({ sessionId, messageId, seq, createdAt: T0 + seq * 60_000 })

describe('botScope helpers', () => {
  it('passes non-bot profiles through untouched', () => {
    const sub = sampleWorld()
    const desktop = makeCtx(sub, { origin: { channel: 'wechat-ilink', chatId: DM } })
    expect(isBotContext(desktop)).toBe(false)
    expect(botOriginChatId(desktop)).toBeUndefined()
    expect(scopeBotSessions(desktop, ['x', 'y'])).toEqual({ ok: true, value: ['x', 'y'] })
    expect(scopeBotSessions(desktop, undefined)).toEqual({ ok: true, value: undefined })
    expect(scopeBotSession(desktop, GROUP)).toEqual({ ok: true, value: GROUP })
    expect(scopeBotSession(desktop, undefined)).toEqual({ ok: true, value: undefined })
    expect(refuseForBot(desktop)).toBeUndefined()
    for (const profile of ['cron', 'subagent'] as const) {
      expect(scopeBotSessions(makeCtx(sub, { profile }), [GROUP]), profile).toEqual({ ok: true, value: [GROUP] })
    }
  })
  it('forces an omitted scope to the origin chat and refuses anything else under the bot', () => {
    const sub = sampleWorld()
    const ctx = makeCtx(sub, bot(DM))
    expect(isBotContext(ctx)).toBe(true)
    expect(botOriginChatId(ctx)).toBe(DM)
    expect(scopeBotSessions(ctx, undefined)).toEqual({ ok: true, value: [DM] })
    expect(scopeBotSessions(ctx, [DM])).toEqual({ ok: true, value: [DM] })
    expect(scopeBotSessions(ctx, [DM, ` ${DM} `])).toEqual({ ok: true, value: [DM] })
    expect(scopeBotSession(ctx, undefined)).toEqual({ ok: true, value: DM })
    expect(scopeBotSession(ctx, DM)).toEqual({ ok: true, value: DM })

    const mixed = scopeBotSessions(ctx, [DM, GROUP, 'user_b'])
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) {
      expect(mixed.result.isError).toBe(true)
      expect(body(mixed.result)).toMatchObject({ origin: DM, refused: [GROUP, 'user_b'] })
      expect(body(mixed.result).error).toContain(DM)
    }
    expect(scopeBotSession(ctx, GROUP).ok).toBe(false)
    expect(refuseForBot(ctx)).toMatchObject({ isError: true, content: { error: BOT_TOOL_REFUSED_MESSAGE } })
  })
  it('refuses every read when the bot has no usable origin', () => {
    const sub = sampleWorld()
    for (const ctx of [makeCtx(sub, bot(undefined)), makeCtx(sub, bot('   '))]) {
      const scoped = scopeBotSessions(ctx, undefined)
      expect(scoped.ok).toBe(false)
      if (!scoped.ok) expect(body(scoped.result).error).toBe(BOT_NO_ORIGIN_MESSAGE)
      expect(scopeBotSessions(ctx, [DM]).ok).toBe(false)
      expect(scopeBotSession(ctx, DM).ok).toBe(false)
    }
  })
})

describe('wechat-bot: search_messages / semantic_search', () => {
  it('search_messages without sessionIds is forced to the origin chat', async () => {
    const sub = sampleWorld()
    const res = await runTool(searchMessages, { query: '火锅' }, sub, bot(DM))
    expect(res.isError).toBeUndefined()
    const out = body(res)
    expect(sub.calls[0]).toEqual({ method: 'search', args: [{ query: '火锅', sessionIds: [DM], limit: 10, mode: 'keyword' }] })
    expect(out.hits).toHaveLength(2)
    expect(out.hits.every((h: { anchor: { sessionId: string } }) => h.anchor.sessionId === DM)).toBe(true)
    expect(out.coverage).toMatchObject({ scope: 'sessions', sessionIds: [DM], bounded: false })
    // Content that only exists in another session is invisible to the bot.
    expect(body(await runTool(searchMessages, { query: '周报' }, sub, bot(DM))).hits).toEqual([])
  })
  it('search_messages refuses other sessions before touching the substrate', async () => {
    const sub = sampleWorld()
    const res = await runTool(searchMessages, { query: '周报', sessionIds: [GROUP] }, sub, bot(DM))
    expect(res.isError).toBe(true)
    expect(body(res)).toMatchObject({ origin: DM, refused: [GROUP] })
    expect((await runTool(searchMessages, { query: '周报', sessionIds: [DM, GROUP] }, sub, bot(DM))).isError).toBe(true)
    expect(sub.calls).toEqual([])
    // Explicitly naming the origin chat is fine.
    expect((await runTool(searchMessages, { query: '火锅', sessionIds: [DM] }, sub, bot(DM))).isError).toBeUndefined()
  })
  it('search_messages refuses when the bot origin is unknown', async () => {
    const sub = sampleWorld()
    const res = await runTool(searchMessages, { query: '火锅' }, sub, bot(undefined))
    expect(res.isError).toBe(true)
    expect(body(res).error).toBe(BOT_NO_ORIGIN_MESSAGE)
    expect(sub.calls).toEqual([])
  })
  it('semantic_search is forced to the origin chat and refuses other sessions', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(semanticSearch, { query: '吃饭 火锅' }, sub, bot(DM)))
    expect(sub.calls[0]).toEqual({ method: 'search', args: [{ query: '吃饭 火锅', sessionIds: [DM], limit: 8, mode: 'hybrid' }] })
    expect(out.coverage).toMatchObject({ scope: 'sessions', sessionIds: [DM] })
    const refused = await runTool(semanticSearch, { query: '周报', sessionIds: [GROUP] }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(sub.calls).toHaveLength(1)
    expect((await runTool(semanticSearch, { query: 'x' }, sub, bot(undefined))).isError).toBe(true)
  })
  it('desktop-chat threads are not scoped even when they carry a wechat origin (profile decides)', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(searchMessages, { query: '周报' }, sub, { profile: 'desktop-chat', origin: { channel: 'wechat-ilink', chatId: DM } }))
    expect(out.hits.map((h: { anchor: { messageId: string } }) => h.anchor.messageId).sort()).toEqual(['g1', 'g2'])
    expect(out.coverage.scope).toBe('all_indexed')
  })
})

describe('wechat-bot: single-session tools', () => {
  it('get_context refuses an anchor from another session and allows the origin chat', async () => {
    const sub = sampleWorld()
    const refused = await runTool(getContext, { anchor: anchorIn(GROUP, 'g2', 2), radius: 2 }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(body(refused)).toMatchObject({ origin: DM, refused: [GROUP] })
    expect(sub.calls).toEqual([])
    const ok = await runTool(getContext, { anchor: anchorIn(DM, 'm3', 3), radius: 1 }, sub, bot(DM))
    expect(ok.isError).toBeUndefined()
    expect(body(ok).messages.map((m: { anchor: { messageId: string } }) => m.anchor.messageId)).toEqual(['m2', 'm3', 'm4'])
    expect((await runTool(getContext, { anchor: anchorIn(DM, 'm3', 3) }, sub, bot(undefined))).isError).toBe(true)
  })
  it('get_timeline refuses another session and allows the origin chat', async () => {
    const sub = sampleWorld()
    const refused = await runTool(getTimeline, { sessionId: GROUP, limit: 5 }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(sub.calls).toEqual([])
    const ok = body(await runTool(getTimeline, { sessionId: DM, limit: 2 }, sub, bot(DM)))
    expect(ok.messages.map((m: { anchor: { messageId: string } }) => m.anchor.messageId)).toEqual(['m5', 'm6'])
    expect((await runTool(getTimeline, { sessionId: DM }, sub, bot(undefined))).isError).toBe(true)
  })
  it('chat_stats forces an omitted sessionId to the origin chat (no global ranking) and refuses others', async () => {
    const sub = sampleWorld()
    const out = body(await runTool(chatStats, { metric: 'ranking', limit: 5 }, sub, bot(DM)))
    expect(sub.calls[0]).toEqual({ method: 'stats', args: [{ metric: 'ranking', sessionId: DM, limit: 5 }] })
    expect(out.scope).toEqual({ sessionId: DM })
    // Ranking inside the origin dm is per sender, never a cross-session contact ranking.
    expect(out.rows.map((r: { id: string }) => r.id).sort()).toEqual(['me', DM])
    const refused = await runTool(chatStats, { metric: 'overview', sessionId: GROUP }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(sub.calls).toHaveLength(1)
    expect((await runTool(chatStats, { metric: 'overview' }, sub, bot(undefined))).isError).toBe(true)
  })
  it('group_members only serves the group the bot is bound to', async () => {
    const sub = sampleWorld()
    const refused = await runTool(groupMembers, { groupId: GROUP }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(sub.calls).toEqual([])
    const ok = body(await runTool(groupMembers, { groupId: GROUP }, sub, bot(GROUP)))
    expect(ok.members).toHaveLength(3)
    expect((await runTool(groupMembers, { groupId: GROUP }, sub, bot(undefined))).isError).toBe(true)
  })
  it('group_member_ranking only serves the group the bot is bound to', async () => {
    const sub = sampleWorld()
    const refused = await runTool(groupMemberRanking, { groupId: GROUP }, sub, bot(DM))
    expect(refused.isError).toBe(true)
    expect(sub.calls).toEqual([])
    const ok = body(await runTool(groupMemberRanking, { groupId: GROUP, limit: 5 }, sub, bot(GROUP)))
    expect(ok.rows[0]).toMatchObject({ rank: 1, id: 'user_b' })
    expect((await runTool(groupMemberRanking, { groupId: GROUP }, sub, bot(undefined))).isError).toBe(true)
  })
})

describe('wechat-bot: enumeration / cross-session tools are not mounted and refuse anyway', () => {
  const cases: Array<{ name: string; tool: typeof listSessions | typeof listContacts | typeof listGroups | typeof searchMedia; input: unknown }> = [
    { name: 'list_sessions', tool: listSessions, input: {} },
    { name: 'list_contacts', tool: listContacts, input: { query: '阿' } },
    { name: 'list_groups', tool: listGroups, input: {} },
    { name: 'search_media', tool: searchMedia, input: { kind: 'image' } },
  ]
  for (const { name, tool, input } of cases) {
    it(`${name} is not offered to the bot profile`, () => {
      expect(tool.name).toBe(name)
      expect(tool.profiles).not.toContain('wechat-bot')
      expect(tool.profiles).toEqual(['desktop-chat', 'cron', 'subagent'])
    })
    it(`${name} refuses a bot context at runtime without touching the substrate`, async () => {
      const sub = sampleWorld()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await runTool(tool as any, input, sub, bot(DM))
      expect(res.isError).toBe(true)
      expect(body(res).error).toBe(BOT_TOOL_REFUSED_MESSAGE)
      expect(sub.calls).toEqual([])
      // Still works for the owner.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((await runTool(tool as any, input, sub)).isError).toBeUndefined()
    })
  }
})
