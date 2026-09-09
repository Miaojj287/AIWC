/**
 * list_sessions — enumerate chats (dm / group / official) by title, newest activity first. The
 * returned `id` is the sessionId every other tool expects.
 */
import { z } from 'zod'
import { refuseForBot } from './botScope'
import { READ_PROFILES_NO_BOT, compactSession, defineSubstrateTool, describeToolError, fail, ok } from './shared'

const ListSessionsInput = z.object({
  query: z.string().trim().max(100).optional().describe('按会话标题（备注 / 昵称 / 群名）模糊匹配；留空列出最近活跃的会话'),
  kind: z.enum(['dm', 'group', 'official', 'system', 'all']).default('all').describe('会话类型过滤：dm 私聊、group 群聊、official 公众号、system 系统；默认 all'),
  limit: z.number().int().min(1).max(50).default(20).describe('返回条数上限（≤50）'),
})

export type ListSessionsInput = z.infer<typeof ListSessionsInput>

export const listSessions = defineSubstrateTool({
  name: 'list_sessions',
  description:
    '列出会话（私聊 / 群聊 / 公众号），按最近活跃排序；返回的 id 就是其它工具要的 sessionId，用于「最近和谁聊 / 有哪些群 / 找某个会话的 id」。只读本地已同步的数据，不上传。\n' +
    'List chats (dm / group / official) ordered by recent activity. The returned `id` is the sessionId used by search_messages / get_timeline / chat_stats. Reads the local index only.',
  inputSchema: ListSessionsInput,
  // Enumerates the owner's whole chat list: never offered to the bot (its replies reach the peer).
  profiles: READ_PROFILES_NO_BOT,
  risk: 'read',
  parallelSafe: true,
  summarize: (i) => (i.query ? `查找会话「${i.query}」` : `列出最近 ${i.limit} 个会话`),
  async execute(input, ctx) {
    const refused = refuseForBot(ctx)
    if (refused) return refused
    try {
      const q: Parameters<typeof ctx.services.substrate.listSessions>[0] = { limit: input.limit, kind: input.kind }
      if (input.query) q.query = input.query
      const res = await ctx.services.substrate.listSessions(q)
      return ok({
        sessions: res.items.map(compactSession),
        total: res.total,
        hasMore: res.hasMore,
        ...(res.items.length === 0 ? { note: input.query ? `没有标题匹配「${input.query}」的会话，可换关键词或用 list_contacts 按联系人查找。` : '本地索引里还没有会话，可能尚未完成同步。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'list_sessions 执行失败'))
    }
  },
})
