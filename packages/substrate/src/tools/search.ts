/**
 * search_messages (keyword / FTS) and semantic_search (hybrid vector + keyword). Both return hits
 * carrying a MessageAnchor the model must pass to get_context to verify and cite evidence, plus a
 * `coverage` block describing exactly what was searched (global scans are bounded by the index).
 */
import type { SearchHit, SearchQuery, SubstrateService } from '@aiwc/protocol'
import { z } from 'zod'
import { scopeBotSessions } from './botScope'
import {
  ABORTED_MESSAGE,
  READ_PROFILES,
  TimeRangeRefinement,
  anchorsMeta,
  compactHit,
  createNameResolver,
  defineSubstrateTool,
  describeCoverage,
  describeToolError,
  fail,
  isAborted,
  ok,
  timeFrom,
  timeTo,
  type CompactHit,
} from './shared'

/** Compact hits with the chat title and a resolved sender name — what a global search needs to be readable. */
async function shapeHits(substrate: SubstrateService, hits: SearchHit[], limit: number): Promise<CompactHit[]> {
  const names = createNameResolver(substrate)
  const top = hits.slice(0, limit)
  const messages = await names.withSenderNames(top.map((h) => h.message))
  return Promise.all(
    top.map(async (h, i) => {
      const shaped = compactHit({ ...h, message: messages[i] ?? h.message })
      const chat = await names.session(shaped.anchor.sessionId)
      return chat ? { ...shaped, chat } : shaped
    }),
  )
}

const NO_SEMANTIC_NOTE =
  '当前没有可用的语义（向量）索引：本次实际只做了关键词检索。换几个具体关键词分别用 search_messages 搜，比再试语义检索更有效。'

const SessionIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(20)
  .optional()
  .describe(
    '限定会话 id 列表（username，来自 list_contacts / list_sessions）；不传则全局搜索，但全局只覆盖本地索引，可能不完整',
  )

const SearchMessagesInput = z
  .object({
    query: z.string().trim().min(1).max(200).describe('关键词 / 词组'),
    sessionIds: SessionIdsSchema,
    from: timeFrom().optional(),
    to: timeTo().optional(),
    limit: z.number().int().min(1).max(80).default(20).describe('返回条数上限（≤80）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

const SemanticSearchInput = z
  .object({
    query: z.string().trim().min(1).max(300).describe('自然语言检索意图 / 主题描述'),
    sessionIds: SessionIdsSchema,
    from: timeFrom().optional(),
    to: timeTo().optional(),
    limit: z.number().int().min(1).max(40).default(15).describe('返回条数上限（≤40）'),
  })
  .refine(TimeRangeRefinement.check, { message: TimeRangeRefinement.message, path: ['from'] })

export type SearchMessagesInput = z.infer<typeof SearchMessagesInput>
export type SemanticSearchInput = z.infer<typeof SemanticSearchInput>

function buildQuery(
  input: { query: string; from?: number; to?: number; limit: number },
  sessionIds: readonly string[] | undefined,
  mode: SearchQuery['mode'],
): SearchQuery {
  // The agent asks natural-language questions: match Chinese by words, not only by the exact phrase.
  const q: SearchQuery = { query: input.query, limit: input.limit, mode, match: 'relaxed' }
  if (sessionIds && sessionIds.length > 0) q.sessionIds = [...sessionIds]
  if (input.from !== undefined) q.from = input.from
  if (input.to !== undefined) q.to = input.to
  return q
}

export const searchMessages = defineSubstrateTool({
  name: 'search_messages',
  description:
    '按关键词检索聊天记录原文，适合「谁提过 X / 搜含某个词的消息 / 找某件具体的事」。中文查询会同时按整句和分词匹配，人名等两字词按包含匹配；一次只放一两个关键词，多个角度就多搜几次。每条命中带 anchor（证据锚点）和可直接粘贴的 cite，拿到后用 get_context 展开前后原文核对、引用出处。强烈建议带 sessionIds 限定范围；不带则全局搜索，只覆盖本地索引，结果里的 coverage 会说明搜了什么。要数量 / 排名用 chat_stats，不要用检索去数。\n' +
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
      const shaped = await shapeHits(substrate, hits, input.limit)
      const coverage = describeCoverage(substrate, { sessionIds: scope.value, from: input.from, to: input.to })
      return ok(
        {
          mode: 'keyword',
          query: input.query,
          hits: shaped,
          coverage,
          ...(shaped.length === 0
            ? {
                note: '没有命中。换同义词或更短的词（比如只搜人名、只搜一个关键词）、放宽时间范围，或用 get_timeline 直接通读那段时间的对话。',
              }
            : {}),
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
      const shaped = await shapeHits(substrate, hits, input.limit)
      const sources = new Set(shaped.map((h) => h.source))
      // The substrate silently falls back to keywords when no embedding model is configured; say so
      // instead of letting the model believe it searched by meaning.
      const semantic = shaped.some((h) => h.source !== 'fts')
      const coverage = describeCoverage(substrate, { sessionIds: scope.value, from: input.from, to: input.to })
      return ok(
        {
          mode: semantic ? 'hybrid' : 'keyword',
          query: input.query,
          hits: shaped,
          matchedBy: [...sources],
          coverage,
          ...(shaped.length === 0
            ? { note: '没有相关内容。可换一种描述，或用 search_messages 搜精确关键词。' }
            : !semantic
              ? { note: NO_SEMANTIC_NOTE }
              : {}),
        },
        anchorsMeta(shaped.map((h) => h.anchor)),
      )
    } catch (error) {
      return fail(describeToolError(error, 'semantic_search 执行失败'))
    }
  },
})
