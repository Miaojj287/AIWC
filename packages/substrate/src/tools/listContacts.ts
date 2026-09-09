/**
 * list_contacts — resolve a person / group name into its username (= sessionId for other tools).
 */
import { z } from 'zod'
import { refuseForBot } from './botScope'
import { READ_PROFILES_NO_BOT, compactContact, defineSubstrateTool, describeToolError, fail, ok } from './shared'

const ListContactsInput = z.object({
  query: z.string().trim().min(1).max(100).describe('人名 / 群名片段，匹配备注、微信昵称、群名、username'),
  kind: z.enum(['friend', 'group', 'official', 'stranger', 'all']).default('all').describe('联系人类型过滤，默认 all'),
  limit: z.number().int().min(1).max(30).default(10).describe('返回条数上限（≤30）'),
})

export type ListContactsInput = z.infer<typeof ListContactsInput>

export const listContacts = defineSubstrateTool({
  name: 'list_contacts',
  description:
    '把人名 / 群名解析成 username（微信内部 id）。其它工具要限定「某个人 / 某个群」时，sessionId 填的就是这里返回的 username——先用本工具拿 id，再去检索 / 读时间线。这是查「联系人是谁」，不是查聊天内容。只读本地数据。\n' +
    'Resolve a display name (remark / nickname / group name) to its WeChat username, which is the sessionId other tools take. Use search_messages / semantic_search for message content instead.',
  inputSchema: ListContactsInput,
  // Resolves names across the owner's whole contact graph: never offered to the bot.
  profiles: READ_PROFILES_NO_BOT,
  risk: 'read',
  parallelSafe: true,
  summarize: (i) => `查找联系人「${i.query}」`,
  async execute(input, ctx) {
    const refused = refuseForBot(ctx)
    if (refused) return refused
    try {
      const res = await ctx.services.substrate.listContacts({ query: input.query, kind: input.kind, limit: input.limit })
      return ok({
        contacts: res.items.map(compactContact),
        total: res.total,
        ...(res.items.length === 0 ? { note: `没有匹配「${input.query}」的联系人；可尝试更短的关键词，或用 list_sessions 按会话标题查找。` } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'list_contacts 执行失败'))
    }
  },
})
