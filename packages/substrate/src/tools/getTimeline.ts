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
  createNameResolver,
  dedupeMessages,
  defineSubstrateTool,
  describeToolError,
  fail,
  fmtTime,
  ok,
  sortBySeq,
  timeFrom,
  timeTo,
} from './shared'

const GetTimelineInput = z
  .object({
    sessionId: z.string().trim().min(1).describe('会话 id（username，来自 list_contacts / list_sessions）'),
    from: timeFrom('起始时间（含），如「2026-02-14」「2026-02-14 19:28」；不传则不设下限').optional(),
    to: timeTo('结束时间（含），只写日期表示到当天结束；不传则到现在').optional(),
    beforeSeq: z.number().int().optional().describe('往前翻页：填上一次结果里的 olderCursor，读更早的一页'),
    afterSeq: z
      .number()
      .int()
      .optional()
      .describe('往后翻页：填上一次结果里的 newerCursor；想从时间窗开头顺着往后读就填 0'),
    limit: z.number().int().min(1).max(200).default(80).describe('返回条数上限（≤200）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })
  .refine((v) => v.beforeSeq === undefined || v.afterSeq === undefined, {
    message: 'beforeSeq 和 afterSeq 只能填一个',
    path: ['beforeSeq'],
  })

export type GetTimelineInput = z.infer<typeof GetTimelineInput>

export const getTimeline = defineSubstrateTool({
  name: 'get_timeline',
  description:
    '按时间顺序读取某个会话在指定时间窗内的连续消息原文，适合「某天 / 某段时间聊了什么」「把这段对话讲清楚」「判断两人关系怎么发展」。必须给 sessionId（先用 list_contacts 拿）；不给时间范围则取最近的一段。一页读不完时 hasMore 为 true：用 olderCursor 往前翻、newerCursor 往后翻，直到读完再下结论，不要只凭一页猜。每条消息带 anchor 和可直接粘贴的 cite。只读单个会话；跨会话找内容用 search_messages。\n' +
    "Read one session's messages in a time window, oldest first, each with an evidence anchor. Single-session only; use search_messages across sessions.",
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
      if (input.afterSeq !== undefined) q.afterSeq = input.afterSeq
      else if (input.beforeSeq !== undefined) q.beforeSeq = input.beforeSeq
      const res = await ctx.services.substrate.listMessages(q)
      const ordered = await createNameResolver(ctx.services.substrate).withSenderNames(
        sortBySeq(dedupeMessages(res.items)),
      )
      const messages = ordered.map(compactMessage)
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      return ok(
        {
          sessionId: input.sessionId,
          window: { from: fmtTime(input.from), to: fmtTime(input.to) },
          covered: first && last ? { from: fmtTime(first.createdAt), to: fmtTime(last.createdAt) } : null,
          hasMore: res.hasMore,
          // Paging forward (afterSeq) leaves newer messages unread; every other read leaves older ones.
          ...(res.hasMore && first && last
            ? input.afterSeq !== undefined
              ? { newerCursor: last.seq }
              : { olderCursor: first.seq }
            : {}),
          ...(input.afterSeq === undefined && input.beforeSeq !== undefined && last ? { newerCursor: last.seq } : {}),
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
