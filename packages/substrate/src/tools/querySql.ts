/**
 * query_sql — audited, read-only SQL escape hatch. Only for desktop-chat / subagent, never for the
 * bot / cron / plan profiles. The statement is forwarded as written: SubstrateService.querySql runs the
 * substrate's one read-only guard (shared/sqlGuard.ts), so this description only promises what that
 * guard accepts. querySql itself is optional: when the substrate does not expose it the tool reports
 * unavailability instead of failing.
 */
import type { JsonValue, ToolProfile } from '@aiwc/protocol'
import { z } from 'zod'
import { SQL_MAX_LIMIT } from '../shared/sqlGuard'
import { defineSubstrateTool, describeToolError, fail, ok, squash } from './shared'

const MAX_CELL_CHARS = 500
/** Rows returned when the model does not ask for a count. */
const DEFAULT_ROW_LIMIT = 100

/** Schema discovery with a plain SELECT: `sql` is each table's CREATE statement, every column included. */
export const SCHEMA_DISCOVERY_SQL = "SELECT name, sql FROM sqlite_master WHERE type = 'table'"

/** Keep cells small and JSON-safe: blobs become a marker, long strings are cut, exotic types stringified. */
export function sanitizeCell(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[blob]'
  try {
    return squash(JSON.stringify(value), MAX_CELL_CHARS)
  } catch {
    return String(value)
  }
}

const QuerySqlInput = z.object({
  db: z
    .enum(['message', 'contact', 'session'])
    .describe('目标库：message 聊天正文，contact 联系人 / 群，session 会话列表'),
  sql: z.string().trim().min(1).max(4000).describe('单条只读 SQL（SELECT / WITH）'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SQL_MAX_LIMIT)
    .default(DEFAULT_ROW_LIMIT)
    .describe(`返回行数上限（≤${SQL_MAX_LIMIT}）`),
  reason: z.string().trim().min(1).max(500).describe('为什么本次必须用 SQL 兜底（审计字段）'),
  attemptedTools: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(20)
    .describe('已经尝试过且不足以回答的结构化工具名，至少一个'),
  whyStructuredToolsInsufficient: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('这些结构化工具为什么无法覆盖本次查询（审计字段）'),
})

export type QuerySqlInput = z.infer<typeof QuerySqlInput>

const PROFILES: readonly ToolProfile[] = ['desktop-chat', 'subagent']

export const querySql = defineSubstrateTool({
  name: 'query_sql',
  description:
    '【兜底 · 只读 · 最后手段】仅当 search_messages / semantic_search / chat_stats / get_timeline / get_context / list_groups / group_members 都无法回答时，才直接写只读 SQL 查本地微信数据。必须填 reason、attemptedTools、whyStructuredToolsInsufficient 三个审计字段；没试过结构化工具就写 SQL 属于错误用法。' +
    `表结构需自己探查：${SCHEMA_DISCOVERY_SQL}（sql 列就是建表语句，含全部列名）。只允许单条 SELECT / WITH 查询，最多返回 ${SQL_MAX_LIMIT} 行；PRAGMA、EXPLAIN、写入 / DDL / 事务都会被拒绝。别 SELECT 头像 / 图片等大字段。数据不出本机。\n` +
    `Audited read-only SQL fallback over the local WeChat databases. Requires non-empty audit fields. A single SELECT / WITH statement only, at most ${SQL_MAX_LIMIT} rows; discover tables and columns with ${SCHEMA_DISCOVERY_SQL}. PRAGMA, EXPLAIN and anything else is rejected before execution.`,
  inputSchema: QuerySqlInput,
  profiles: PROFILES,
  risk: 'read',
  parallelSafe: false,
  timeoutMs: 30_000,
  maxOutputChars: 32_000,
  summarize: (i) => `只读 SQL（${i.db}）：${squash(i.sql, 60)}`,
  async execute(input, ctx) {
    const substrate = ctx.services.substrate
    const audit = {
      reason: input.reason,
      attemptedTools: input.attemptedTools,
      whyStructuredToolsInsufficient: input.whyStructuredToolsInsufficient,
    }
    if (typeof substrate.querySql !== 'function') {
      return fail(
        'query_sql 在当前数据源上不可用（未开放只读 SQL 通道）。请改用 search_messages / chat_stats / get_timeline 等结构化工具。',
        { db: input.db, audit },
      )
    }
    try {
      // Rejections from the substrate's guard come back as errors and reach the model verbatim.
      const res = await substrate.querySql({ db: input.db, sql: input.sql, limit: input.limit })
      const rows = res.rows.slice(0, input.limit).map((row) => row.map(sanitizeCell))
      return ok({
        db: input.db,
        audit,
        columns: res.columns,
        rowCount: rows.length,
        truncated: res.rows.length > rows.length,
        rows,
        ...(rows.length === 0 ? { note: '查询没有返回行。' } : {}),
      })
    } catch (error) {
      return fail(describeToolError(error, 'query_sql 执行失败'), { db: input.db, audit })
    }
  },
})
