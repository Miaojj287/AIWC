/**
 * search_messages (keyword / FTS) and semantic_search (hybrid vector + keyword). Both return hits
 * carrying a MessageAnchor the model must pass to get_context to verify and cite evidence, plus a
 * `coverage` block describing exactly what was searched (global scans are bounded by the index).
 */
import type { SearchQuery } from '@aiwc/protocol'
import { z } from 'zod'
import { scopeBotSessions } from './botScope'
import {
  ABORTED_MESSAGE,
  READ_PROFILES,
  TimeRangeRefinement,
  anchorsMeta,
  compactHit,
  defineSubstrateTool,
  describeCoverage,
  describeToolError,
  fail,
  isAborted,
  ok,
} from './shared'

const SessionIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(20)
  .optional()
  .describe('限定会话 id 列表（username，来自 list_contacts / list_sessions）；不传则全局搜索，但全局只覆盖本地索引，可能不完整')

const SearchMessagesInput = z
  .object({
    query: z.string().trim().min(1).max(200).describe('关键词 / 词组'),
    sessionIds: SessionIdsSchema,
    from: z.number().int().nonnegative().optional().describe('起始时间，毫秒时间戳'),
    to: z.number().int().nonnegative().optional().describe('结束时间，毫秒时间戳'),
    limit: z.number().int().min(1).max(50).default(10).describe('返回条数上限（≤50）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

const SemanticSearchInput = z.object({
  query: z.string().trim().min(1).max(300).describe('自然语言检索意图 / 主题描述'),
  sessionIds: SessionIdsSchema,
  limit: z.number().int().min(1).max(20).default(8).describe('返回条数上限（≤20）'),
})

export type SearchMessagesInput = z.infer<typeof SearchMessagesInput>
export type SemanticSearchInput = z.infer<typeof SemanticSearchInput>

function buildQuery(
  input: { query: string; from?: number; to?: number; limit: number },
  sessionIds: readonly string[] | undefined,
  mode: SearchQuery['mode'],
): SearchQuery {
  const q: SearchQuery = { query: input.query, limit: input.limit, mode }
  if (sessionIds && sessionIds.length > 0) q.sessionIds = [...sessionIds]
  if (input.from !== undefined) q.from = input.from
  if (input.to !== undefined) q.to = input.to
  return q
}

export const searchMessages = defineSubstrateTool({
  name: 'search_messages',
  description:
    '按关键词检索聊天记录原文，适合「谁提过 X / 搜含某个词的消息 / 找某件具体的事」。每条命中带 anchor（证据锚点），拿到后用 get_context 展开前后原文核对、引用出处。强烈建议带 sessionIds 限定范围；不带则全局搜索，只覆盖本地索引，结果里的 coverage 会说明搜了什么。要数量 / 排名用 chat_stats，不要用检索去数。\n' +
    'Keyword (FTS) search over local chat history. Each hit carries an evidence anchor for get_context. Global searches are bounded by the local index — read `coverage`. Prefer passing sessionIds.',
  inputSchema: SearchMessagesInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  timeoutMs: 60_000,
  maxOutputChars: 24_000,
  summarize: (i) => `搜索「${i.query}」${i.sessionIds ? `（${i.sessionIds.length} 个会话）` : '（全局）'}`,
  async execute(input, ctx) {
    try {
      if (isAborted(ctx.signal)) return fail(ABORTED_MESSAGE)
      const scope = scopeBotSessions(ctx, input.sessionIds)
      if (!scope.ok) return scope.result
      const substrate = ctx.services.substrate
      const hits = await substrate.search(buildQuery(input, scope.value, 'keyword'))
      const shaped = hits.slice(0, input.limit).map(compactHit)
      const coverage = describeCoverage(substrate, { sessionIds: scope.value, from: input.from, to: input.to })
      return ok(
        {
          mode: 'keyword',
          query: input.query,
          hits: shaped,
          coverage,
          ...(shaped.length === 0 ? { note: '没有命中。可换同义词、放宽时间范围，或用 semantic_search 按主题找。' } : {}),
        },
        anchorsMeta(shaped.map((h) => h.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'search_messages 执行失败'))
    }
  },
})

export const semanticSearch = defineSubstrateTool({
  name: 'semantic_search',
  description:
    '按主题 / 语义查找相关聊天记录（向量 + 关键词混合检索），适合「聊过类似 X 吗 / 关于某话题都说了啥」。每条命中带 anchor（证据锚点），用 get_context 展开核对、标注出处。建议带 sessionIds 限定范围；全局只覆盖本地索引，coverage 字段说明范围。要精确词用 search_messages；要数量用 chat_stats。\n' +
    'Hybrid (vector + keyword) semantic search over local chat history. Hits carry evidence anchors for get_context. Global searches are bounded by the local index — read `coverage`.',
  inputSchema: SemanticSearchInput,
  profiles: READ_PROFILES,
  risk: 'read',
  parallelSafe: true,
  timeoutMs: 90_000,
  maxOutputChars: 24_000,
  summarize: (i) => `语义检索「${i.query}」${i.sessionIds ? `（${i.sessionIds.length} 个会话）` : '（全局）'}`,
  async execute(input, ctx) {
    try {
      if (isAborted(ctx.signal)) return fail(ABORTED_MESSAGE)
      const scope = scopeBotSessions(ctx, input.sessionIds)
      if (!scope.ok) return scope.result
      const substrate = ctx.services.substrate
      const hits = await substrate.search(buildQuery(input, scope.value, 'hybrid'))
      const shaped = hits.slice(0, input.limit).map(compactHit)
      const sources = new Set(shaped.map((h) => h.source))
      const coverage = describeCoverage(substrate, { sessionIds: scope.value })
      return ok(
        {
          mode: 'hybrid',
          query: input.query,
          hits: shaped,
          matchedBy: [...sources],
          coverage,
          ...(shaped.length === 0 ? { note: '没有相关内容。可换一种描述，或用 search_messages 搜精确关键词。' } : {}),
        },
        anchorsMeta(shaped.map((h) => h.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'semantic_search 执行失败'))
    }
  },
})
