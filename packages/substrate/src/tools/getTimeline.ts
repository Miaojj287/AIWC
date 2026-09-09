/**
 * get_timeline — read one session's messages inside a time window, oldest first.
 */
import type { ListMessagesQuery } from '@aiwc/protocol'
import { z } from 'zod'
import { scopeBotSession } from './botScope'
import {
  READ_PROFILES,
  TimeRangeRefinement,
  anchorsMeta,
  compactMessage,
  dedupeMessages,
  defineSubstrateTool,
  describeToolError,
  fail,
  fmtTime,
  ok,
  sortBySeq,
} from './shared'

const GetTimelineInput = z
  .object({
    sessionId: z.string().trim().min(1).describe('会话 id（username，来自 list_contacts / list_sessions）'),
    from: z.number().int().nonnegative().optional().describe('起始时间，毫秒时间戳；不传则不设下限'),
    to: z.number().int().nonnegative().optional().describe('结束时间，毫秒时间戳；不传则到现在'),
    limit: z.number().int().min(1).max(200).default(50).describe('返回条数上限（≤200）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

export type GetTimelineInput = z.infer<typeof GetTimelineInput>

export const getTimeline = defineSubstrateTool({
  name: 'get_timeline',
  description:
    '按时间顺序读取某个会话在指定时间窗内的连续消息原文，适合「某天 / 某段时间聊了什么」「把这段对话讲清楚」。必须给 sessionId（先用 list_contacts 拿）；不给时间范围则取最近的一段。每条消息带 anchor（证据锚点），可直接引用。只读单个会话；跨会话找内容用 search_messages。\n' +
    'Read one session\'s messages in a time window, oldest first, each with an evidence anchor. Single-session only; use search_messages across sessions.',
  inputSchema: GetTimelineInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  maxOutputChars: 64_000,
  summarize: (i) => `读取时间线（${i.sessionId} · ${i.limit} 条）`,
  async execute(input, ctx) {
    const scope = scopeBotSession(ctx, input.sessionId)
    if (!scope.ok) return scope.result
    try {
      const q: ListMessagesQuery = { sessionId: input.sessionId, limit: input.limit }
      if (input.from !== undefined) q.from = input.from
      if (input.to !== undefined) q.to = input.to
      const res = await ctx.services.substrate.listMessages(q)
      const ordered = sortBySeq(dedupeMessages(res.items))
      const messages = ordered.map(compactMessage)
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      return ok(
        {
          sessionId: input.sessionId,
          window: { from: fmtTime(input.from), to: fmtTime(input.to) },
          covered: first && last ? { from: fmtTime(first.createdAt), to: fmtTime(last.createdAt) } : null,
          hasMore: res.hasMore,
          count: messages.length,
          messages,
          ...(messages.length === 0 ? { note: '该时间窗内没有消息：会话可能尚未同步，或时间范围不含消息。' } : {}),
        },
        anchorsMeta(messages.map((m) => m.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'get_timeline 执行失败'))
    }
  },
})
