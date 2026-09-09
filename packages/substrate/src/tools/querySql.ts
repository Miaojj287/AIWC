/**
 * query_sql — audited, read-only SQL escape hatch. Only for desktop-chat / subagent, never for the
 * bot / cron / plan profiles. Statically enforces a single SELECT / WITH / EXPLAIN / PRAGMA
 * table_info statement before forwarding to SubstrateService.querySql (which is itself optional:
 * when the substrate does not expose it the tool reports unavailability instead of failing).
 */
import type { JsonValue, ToolProfile } from '@aiwc/protocol'
import { z } from 'zod'
import { defineSubstrateTool, describeToolError, fail, ok, squash } from './shared'

const READ_ONLY_HEAD = /^(select|with|explain)\b/i
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|truncate|begin|commit|rollback|pragma|savepoint|release)\b/i
const PRAGMA_INFO = /^pragma\s+(table_info|table_xinfo|table_list|index_list|index_info)\s*\(/i
const MAX_CELL_CHARS = 500

/** Validate a single read-only statement; returns the statement without a trailing semicolon. */
export function assertReadOnlySql(sql: string): string {
  const s = String(sql ?? '').trim().replace(/;\s*$/, '').trim()
  if (!s) throw new Error('SQL 为空')
  if (s.includes(';')) throw new Error('只允许单条语句（不要用分号拼多条）')
  const isPragmaInfo = PRAGMA_INFO.test(s)
  if (!READ_ONLY_HEAD.test(s) && !isPragmaInfo) {
    throw new Error('只允许只读查询：SELECT / WITH / EXPLAIN / PRAGMA table_info(...)')
  }
  if (!isPragmaInfo && FORBIDDEN.test(s)) {
    throw new Error('禁止写入 / DDL / 事务 / 其它 PRAGMA 语句')
  }
  return s
}

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
  db: z.enum(['message', 'contact', 'session']).describe('目标库：message 聊天正文，contact 联系人 / 群，session 会话列表'),
  sql: z.string().trim().min(1).max(4000).describe('单条只读 SQL（SELECT / WITH / EXPLAIN / PRAGMA table_info）'),
  limit: z.number().int().min(1).max(500).default(100).describe('返回行数上限（≤500）'),
  reason: z.string().trim().min(1).max(500).describe('为什么本次必须用 SQL 兜底（审计字段）'),
  attemptedTools: z.array(z.string().trim().min(1)).min(1).max(20).describe('已经尝试过且不足以回答的结构化工具名，至少一个'),
  whyStructuredToolsInsufficient: z.string().trim().min(1).max(500).describe('这些结构化工具为什么无法覆盖本次查询（审计字段）'),
})

export type QuerySqlInput = z.infer<typeof QuerySqlInput>

const PROFILES: readonly ToolProfile[] = ['desktop-chat', 'subagent']

export const querySql = defineSubstrateTool({
  name: 'query_sql',
  description:
    '【兜底 · 只读 · 最后手段】仅当 search_messages / semantic_search / chat_stats / get_timeline / get_context / list_groups / group_members 都无法回答时，才直接写只读 SQL 查本地微信数据。必须填 reason、attemptedTools、whyStructuredToolsInsufficient 三个审计字段；没试过结构化工具就写 SQL 属于错误用法。表结构需自己探查：先 SELECT name FROM sqlite_master WHERE type=\'table\'，再 PRAGMA table_info("表名")。仅允许单条只读语句；写入 / DDL / 事务会被拒绝。别 SELECT 头像 / 图片等大字段。数据不出本机。\n' +
    'Audited read-only SQL fallback over the local WeChat databases. Requires non-empty audit fields. Single SELECT / WITH / EXPLAIN / PRAGMA table_info only; anything else is rejected before execution.',
  inputSchema: QuerySqlInput,
  profiles: PROFILES,
  risk: 'read',
  parallelSafe: false,
  timeoutMs: 30_000,
  maxOutputChars: 32_000,
  summarize: (i) => `只读 SQL（${i.db}）：${squash(i.sql, 60)}`,
  async execute(input, ctx) {
    const substrate = ctx.services.substrate
    const audit = { reason: input.reason, attemptedTools: input.attemptedTools, whyStructuredToolsInsufficient: input.whyStructuredToolsInsufficient }
    if (typeof substrate.querySql !== 'function') {
      return fail('query_sql 在当前数据源上不可用（未开放只读 SQL 通道）。请改用 search_messages / chat_stats / get_timeline 等结构化工具。', { db: input.db, audit })
    }
    let safe: string
    try {
      safe = assertReadOnlySql(input.sql)
    } catch (error) {
      return fail(describeToolError(error, 'SQL 校验失败'), { db: input.db, audit })
    }
    try {
      const res = await substrate.querySql({ db: input.db, sql: safe, limit: input.limit })
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
