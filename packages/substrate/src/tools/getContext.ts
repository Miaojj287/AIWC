/**
 * get_context — expand ±radius messages around an evidence anchor so the model can verify a hit
 * and cite "time + sender" when quoting.
 */
import { z } from 'zod'
import { scopeBotSession } from './botScope'
import {
  READ_PROFILES,
  MessageAnchorSchema,
  anchorsMeta,
  compactMessage,
  dedupeMessages,
  defineSubstrateTool,
  describeToolError,
  fail,
  ok,
  sortBySeq,
} from './shared'

const GetContextInput = z.object({
  anchor: MessageAnchorSchema.describe('search_messages / semantic_search 命中里的 anchor，原样填入'),
  radius: z.number().int().min(1).max(30).default(6).describe('锚点前后各取多少条（≤30）'),
})

export type GetContextInput = z.infer<typeof GetContextInput>

export const getContext = defineSubstrateTool({
  name: 'get_context',
  description:
    '展开某条消息前后的上下文原文，用来核对事实、引用出处。入参直接用 search_messages / semantic_search 命中结果里的 anchor（证据锚点）原样填入。返回锚点前后各 radius 条消息（时间 + 发送者 + 原文，按时间正序），锚点那条标 isAnchor。\n' +
    'Expand the messages around an evidence anchor (from a search hit) for verification and citation. Returns ordered compact messages with the anchor flagged.',
  inputSchema: GetContextInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  maxOutputChars: 32_000,
  summarize: (i) => `展开上下文（${i.anchor.sessionId} · ±${i.radius}）`,
  async execute(input, ctx) {
    const scope = scopeBotSession(ctx, input.anchor.sessionId)
    if (!scope.ok) return scope.result
    try {
      const raw = await ctx.services.substrate.getContext(input.anchor, input.radius)
      const ordered = sortBySeq(dedupeMessages(raw))
      if (ordered.length === 0) {
        return fail('未取到上下文：会话可能尚未同步，或锚点无效。请用 search_messages 重新获取 anchor。', {
          sessionId: input.anchor.sessionId,
          anchor: input.anchor,
        })
      }
      const messages = ordered.map((m) => {
        const c = compactMessage(m)
        return m.id === input.anchor.messageId ? { ...c, isAnchor: true } : c
      })
      const anchorFound = messages.some((m) => 'isAnchor' in m)
      return ok(
        {
          sessionId: input.anchor.sessionId,
          anchor: input.anchor,
          messages,
          ...(anchorFound ? {} : { note: '返回的窗口里没有锚点消息本身（可能已被撤回或索引变动），以下为其附近的消息。' }),
        },
        anchorsMeta(messages.map((m) => m.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'get_context 执行失败'))
    }
  },
})
