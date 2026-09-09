/**
 * Group tools: list_groups (sessions of kind 'group', activity first, merged with group contacts
 * when a query is given), group_members (roster) and group_member_ranking (stats ranking scoped to
 * one group).
 */
import type { StatsQuery, WxSession } from '@aiwc/protocol'
import { z } from 'zod'
import { refuseForBot, scopeBotSession } from './botScope'
import {
  READ_PROFILES,
  READ_PROFILES_NO_BOT,
  TimeRangeRefinement,
  compactContact,
  compactSession,
  defineSubstrateTool,
  describeToolError,
  fail,
  fmtTime,
  ok,
} from './shared'

const GROUP_SUFFIX = '@chatroom'

function looksLikeGroup(id: string): boolean {
  return id.endsWith(GROUP_SUFFIX)
}

// ---------------------------------------------------------------------------------------------
// list_groups
// ---------------------------------------------------------------------------------------------

const ListGroupsInput = z.object({
  query: z.string().trim().max(100).optional().describe('群名片段；留空列出最近活跃的群'),
  limit: z.number().int().min(1).max(30).default(20).describe('返回群数量上限（≤30）'),
})

export type ListGroupsInput = z.infer<typeof ListGroupsInput>

export const listGroups = defineSubstrateTool({
  name: 'list_groups',
  description:
    '列出群聊（按最近活跃排序），含成员数。用于「我有哪些群 / 最近活跃的群 / 人多的群」。返回的 id（以 @chatroom 结尾）可填进 group_members / group_member_ranking / get_timeline 的 sessionId / groupId。只读本地数据。\n' +
    'List group chats ordered by recent activity, with member counts. The returned id is the groupId / sessionId for other tools.',
  inputSchema: ListGroupsInput,
  profiles: READ_PROFILES_NO_BOT,
  risk: 'read',
  parallelSafe: true,
  summarize: (i) => (i.query ? `查找群「${i.query}」` : `列出最近 ${i.limit} 个群`),
  async execute(input, ctx) {
    const refused = refuseForBot(ctx)
    if (refused) return refused
    try {
      const substrate = ctx.services.substrate
      const sq: Parameters<typeof substrate.listSessions>[0] = { kind: 'group', limit: input.limit }
      if (input.query) sq.query = input.query
      const sessions = await substrate.listSessions(sq)
      const groups = sessions.items.map(compactSession)

      // Groups the user is in but has no session row for only show up in contacts.
      let supplemented = 0
      if (input.query && groups.length < input.limit) {
        const seen = new Set(groups.map((g) => g.id))
        const contacts = await substrate.listContacts({ query: input.query, kind: 'group', limit: input.limit })
        for (const c of contacts.items) {
          if (seen.has(c.username) || groups.length >= input.limit) continue
          const asSession: WxSession = { id: c.username, kind: 'group', title: c.remark || c.nickname || c.username, unread: 0, pinned: false, muted: false }
          if (typeof c.lastContactAt === 'number') asSession.lastMessageAt = c.lastContactAt
          groups.push(compactSession(asSession))
          seen.add(c.username)
          supplemented += 1
        }
      }

      return ok({
        groups,
        total: Math.max(sessions.total, groups.length),
        ...(supplemented > 0 ? { note: `其中 ${supplemented} 个群来自通讯录、暂无会话记录。` } : {}),
        ...(groups.length === 0 ? { note: input.query ? `没有名称匹配「${input.query}」的群。` : '本地索引里还没有群聊。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'list_groups 执行失败'))
    }
  },
})

// ---------------------------------------------------------------------------------------------
// group_members
// ---------------------------------------------------------------------------------------------

const GroupMembersInput = z.object({
  groupId: z.string().trim().min(1).describe('群 id（username，以 @chatroom 结尾，来自 list_groups / list_contacts）'),
  limit: z.number().int().min(1).max(200).default(100).describe('返回成员上限（≤200）'),
})

export type GroupMembersInput = z.infer<typeof GroupMembersInput>

export const groupMembers = defineSubstrateTool({
  name: 'group_members',
  description:
    '列出某个群的成员（username + 昵称 / 备注），用于「这个群有哪些人 / 某人在不在群里 / 群有多少人」。groupId 是群的 username（以 @chatroom 结尾）。只读本地数据。\n' +
    'List members of a group (username, nickname, remark). groupId is the group\'s username ending in @chatroom.',
  inputSchema: GroupMembersInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  summarize: (i) => `列出群成员（${i.groupId}）`,
  async execute(input, ctx) {
    // A bot bound to a group may list that group's roster (its peers already see it); never another group's.
    const scope = scopeBotSession(ctx, input.groupId)
    if (!scope.ok) return scope.result
    try {
      const res = await ctx.services.substrate.listGroupMembers(input.groupId, { limit: input.limit })
      const members = res.items.slice(0, input.limit).map(compactContact)
      return ok({
        groupId: input.groupId,
        total: res.total,
        hasMore: res.total > members.length,
        members,
        ...(!looksLikeGroup(input.groupId) ? { note: 'groupId 不以 @chatroom 结尾，可能不是群；请用 list_groups 确认。' } : {}),
        ...(members.length === 0 && looksLikeGroup(input.groupId) ? { note: '没有成员数据：群可能尚未同步，或 groupId 无效。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'group_members 执行失败'))
    }
  },
})

// ---------------------------------------------------------------------------------------------
// group_member_ranking
// ---------------------------------------------------------------------------------------------

const GroupMemberRankingInput = z
  .object({
    groupId: z.string().trim().min(1).describe('群 id（username，以 @chatroom 结尾）'),
    from: z.number().int().nonnegative().optional().describe('起始时间，毫秒时间戳'),
    to: z.number().int().nonnegative().optional().describe('结束时间，毫秒时间戳'),
    limit: z.number().int().min(1).max(30).default(20).describe('返回排行条数（≤30）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

export type GroupMemberRankingInput = z.infer<typeof GroupMemberRankingInput>

export const groupMemberRanking = defineSubstrateTool({
  name: 'group_member_ranking',
  description:
    '群内成员发言排行（按消息条数），回答「群里谁最活跃 / 谁发言最多 / 潜水的有谁」。groupId 是群的 username；可加时间范围。这是「群内逐成员」统计；跨会话 / 私聊排行用 chat_stats 的 ranking。只基于本地已同步数据。\n' +
    'Per-member message-count ranking inside one group (stats ranking scoped to the group). For cross-session ranking use chat_stats.',
  inputSchema: GroupMemberRankingInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  timeoutMs: 60_000,
  summarize: (i) => `群成员发言排行（${i.groupId}）`,
  async execute(input, ctx) {
    const scope = scopeBotSession(ctx, input.groupId)
    if (!scope.ok) return scope.result
    try {
      const q: StatsQuery = { metric: 'ranking', sessionId: input.groupId, limit: input.limit }
      if (input.from !== undefined) q.from = input.from
      if (input.to !== undefined) q.to = input.to
      const res = await ctx.services.substrate.stats(q)
      const rows = res.rows.slice(0, input.limit).map((row, i) => ({ rank: i + 1, ...row }))
      return ok({
        groupId: input.groupId,
        range: { from: fmtTime(input.from), to: fmtTime(input.to) },
        rows,
        ...(typeof res.total === 'number' ? { total: res.total } : {}),
        ...(rows.length === 0 ? { note: '没统计到发言：群可能尚未同步，或 groupId 不是群。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'group_member_ranking 执行失败'))
    }
  },
})
