/**
 * chat_stats — aggregate statistics (counts / ranking / time distribution) computed by the
 * substrate, never by retrieval.
 */
import type { StatsQuery } from '@aiwc/protocol'
import { z } from 'zod'
import { scopeBotSession } from './botScope'
import { READ_PROFILES, TimeRangeRefinement, defineSubstrateTool, describeToolError, fail, fmtTime, ok } from './shared'

const ChatStatsInput = z
  .object({
    metric: z.enum(['overview', 'ranking', 'time_distribution']).describe('overview 总览；ranking 互动排行；time_distribution 时间分布'),
    sessionId: z.string().trim().min(1).optional().describe('限定某会话（username）；不传则全局'),
    from: z.number().int().nonnegative().optional().describe('起始时间，毫秒时间戳'),
    to: z.number().int().nonnegative().optional().describe('结束时间，毫秒时间戳'),
    groupBy: z.enum(['hour', 'weekday', 'day', 'month']).optional().describe('time_distribution 的分组维度，默认 hour'),
    limit: z.number().int().min(1).max(100).default(20).describe('ranking 返回条数（≤100）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

export type ChatStatsInput = z.infer<typeof ChatStatsInput>

export const chatStats = defineSubstrateTool({
  name: 'chat_stats',
  description:
    '聚合统计，回答「数量 / 排名 / 频率 / 总和」这类问题——不要拿检索工具去数。metric：overview（消息总数、各类型条数、我发 vs 收到、活跃天数、时间跨度）；ranking（互动最多的联系人 / 群成员排行，可用 sessionId 限定某群）；time_distribution（按 hour / weekday / day / month 的消息量分布）。统计只基于本地已同步的数据。要看具体聊了啥用 get_timeline / search_messages。\n' +
    'Aggregate statistics over the local index: overview, ranking, time_distribution. Use get_timeline / search_messages for content, not this tool.',
  inputSchema: ChatStatsInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  timeoutMs: 60_000,
  summarize: (i) => `统计 ${i.metric}${i.sessionId ? `（${i.sessionId}）` : '（全局）'}`,
  async execute(input, ctx) {
    // Under the bot an omitted sessionId is forced to the origin chat (never a global scan).
    const scope = scopeBotSession(ctx, input.sessionId)
    if (!scope.ok) return scope.result
    const sessionId = scope.value
    try {
      const q: StatsQuery = { metric: input.metric }
      if (sessionId) q.sessionId = sessionId
      if (input.from !== undefined) q.from = input.from
      if (input.to !== undefined) q.to = input.to
      if (input.metric === 'time_distribution') q.groupBy = input.groupBy ?? 'hour'
      if (input.metric === 'ranking') q.limit = input.limit
      const res = await ctx.services.substrate.stats(q)
      const rows = input.metric === 'ranking' ? res.rows.slice(0, input.limit) : res.rows
      return ok({
        metric: res.metric,
        scope: sessionId ? { sessionId } : 'global',
        range: { from: fmtTime(input.from), to: fmtTime(input.to) },
        ...(q.groupBy ? { groupBy: q.groupBy } : {}),
        rows,
        ...(typeof res.total === 'number' ? { total: res.total } : {}),
        ...(rows.length === 0 ? { note: '没有可统计的数据：会话可能尚未同步，或时间范围内没有消息。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'chat_stats 执行失败'))
    }
  },
})
