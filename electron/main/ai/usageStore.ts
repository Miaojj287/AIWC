/**
 * usage.db (node:sqlite): the model call log and per-day usage roll-ups (设置 › 用量与记录). Roll-ups are tiny and kept
 * until the user clears them; the call log is capped (CALL_LOG_MAX_ROWS / CALL_LOG_MAX_AGE_DAYS). Request / response
 * content is only present on rows recorded while 记录内容 was on, and is already redacted by the caller.
 */
import { DatabaseSync } from 'node:sqlite'
import {
  CALL_LOG_MAX_AGE_DAYS,
  CALL_LOG_MAX_ROWS,
  MODEL_USAGE_FEATURES,
  isModelUsageFeature,
  type ModelCallDetail,
  type ModelCallRecord,
  type ModelCallStatus,
  type ModelUsageFeature,
  type UsageSummary,
  type UsageTotals,
} from '@aiwc/protocol'

const DAY_MS = 86_400_000
/** Retention runs every this many inserts, not on each one. */
const PRUNE_EVERY = 50

export interface UsageStoreDeps {
  /** File path, or ':memory:' (tests, or when the file cannot be opened). */
  file: string
  clock?: () => number
}

export interface UsageStore {
  record(call: ModelCallDetail): void
  summary(days: number): UsageSummary
  listCalls(opts: { limit: number; before?: { at: number; id: string }; feature?: ModelUsageFeature }): {
    items: ModelCallRecord[]
    hasMore: boolean
  }
  getCall(id: string): ModelCallDetail | null
  clearUsage(): void
  clearCalls(): void
  /** 记录内容 was turned off: content already recorded goes too. */
  dropContent(): void
  close(): void
}

/** Local calendar day of `ms`, `YYYY-MM-DD`. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const emptyTotals = (): UsageTotals => ({
  requests: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
})

type Row = Record<string, unknown>
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0)
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : num(v))
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function totalsOf(row: Row): UsageTotals {
  return {
    requests: num(row.requests),
    errors: num(row.errors),
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    cachedInputTokens: num(row.cached_tokens),
    reasoningTokens: num(row.reasoning_tokens),
  }
}

const STATUSES: readonly ModelCallStatus[] = ['ok', 'error', 'aborted']

function callOf(row: Row): ModelCallRecord {
  const feature = str(row.feature)
  const status = str(row.status) as ModelCallStatus
  return {
    id: str(row.id),
    at: num(row.at),
    feature: isModelUsageFeature(feature) ? feature : 'other',
    providerId: str(row.provider_id),
    modelId: str(row.model_id),
    local: num(row.local) === 1,
    inputTokens: num(row.input_tokens),
    outputTokens: num(row.output_tokens),
    cachedInputTokens: optNum(row.cached_tokens),
    reasoningTokens: optNum(row.reasoning_tokens),
    latencyMs: num(row.latency_ms),
    firstTokenMs: optNum(row.first_token_ms),
    status: STATUSES.includes(status) ? status : 'error',
    errorCode: optStr(row.error_code),
    httpStatus: optNum(row.http_status),
    hasContent: num(row.has_content) === 1,
  }
}

const SUMS = `SUM(requests) AS requests, SUM(errors) AS errors, SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens, SUM(cached_tokens) AS cached_tokens, SUM(reasoning_tokens) AS reasoning_tokens`
const CALL_COLUMNS = `id, at, feature, provider_id, model_id, local, input_tokens, output_tokens, cached_tokens,
  reasoning_tokens, latency_ms, first_token_ms, status, error_code, http_status,
  (request IS NOT NULL OR response IS NOT NULL) AS has_content`

export function createUsageStore(deps: UsageStoreDeps): UsageStore {
  const clock = deps.clock ?? Date.now
  const db = new DatabaseSync(deps.file)
  if (deps.file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, at INTEGER NOT NULL, feature TEXT NOT NULL, provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL, local INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      cached_tokens INTEGER, reasoning_tokens INTEGER, latency_ms INTEGER NOT NULL, first_token_ms INTEGER,
      status TEXT NOT NULL, error_code TEXT, http_status INTEGER, error_message TEXT, request TEXT, response TEXT
    );
    CREATE INDEX IF NOT EXISTS calls_at ON calls (at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS usage_daily (
      day TEXT NOT NULL, feature TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      local INTEGER NOT NULL, requests INTEGER NOT NULL, errors INTEGER NOT NULL, input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL,
      PRIMARY KEY (day, feature, provider_id, model_id)
    );
  `)
  const insertCall = db.prepare(`INSERT OR REPLACE INTO calls (id, at, feature, provider_id, model_id, local,
    input_tokens, output_tokens, cached_tokens, reasoning_tokens, latency_ms, first_token_ms, status, error_code,
    http_status, error_message, request, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const upsertDaily = db.prepare(`INSERT INTO usage_daily (day, feature, provider_id, model_id, local, requests,
    errors, input_tokens, output_tokens, cached_tokens, reasoning_tokens) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT (day, feature, provider_id, model_id) DO UPDATE SET requests = requests + 1,
    errors = errors + excluded.errors, input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens, cached_tokens = cached_tokens + excluded.cached_tokens,
    reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens, local = excluded.local`)
  let sincePrune = 0

  function prune(): void {
    db.prepare('DELETE FROM calls WHERE at < ?').run(clock() - CALL_LOG_MAX_AGE_DAYS * DAY_MS)
    db.prepare('DELETE FROM calls WHERE id IN (SELECT id FROM calls ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?)').run(
      CALL_LOG_MAX_ROWS,
    )
  }

  return {
    record(call) {
      insertCall.run(
        call.id,
        call.at,
        call.feature,
        call.providerId,
        call.modelId,
        call.local ? 1 : 0,
        call.inputTokens,
        call.outputTokens,
        call.cachedInputTokens ?? null,
        call.reasoningTokens ?? null,
        call.latencyMs,
        call.firstTokenMs ?? null,
        call.status,
        call.errorCode ?? null,
        call.httpStatus ?? null,
        call.errorMessage ?? null,
        call.request ?? null,
        call.response ?? null,
      )
      upsertDaily.run(
        localDay(call.at),
        call.feature,
        call.providerId,
        call.modelId,
        call.local ? 1 : 0,
        call.status === 'error' ? 1 : 0,
        call.inputTokens,
        call.outputTokens,
        call.cachedInputTokens ?? 0,
        call.reasoningTokens ?? 0,
      )
      sincePrune += 1
      if (sincePrune >= PRUNE_EVERY) {
        sincePrune = 0
        prune()
      }
    },

    summary(days) {
      const span = Math.max(1, Math.min(366, Math.floor(days)))
      const to = startOfLocalDay(clock()) + DAY_MS
      const from = startOfLocalDay(to - span * DAY_MS)
      const fromDay = localDay(from)
      const dayRows = db
        .prepare(`SELECT day, ${SUMS} FROM usage_daily WHERE day >= ? GROUP BY day`)
        .all(fromDay) as Row[]
      const byDay = new Map(dayRows.map((r) => [str(r.day), totalsOf(r)]))
      const daysOut: UsageSummary['days'] = []
      const totals = emptyTotals()
      for (let t = from; t < to; t = startOfLocalDay(t + DAY_MS + DAY_MS / 2)) {
        const day = localDay(t)
        const row = byDay.get(day) ?? emptyTotals()
        daysOut.push({ day, ...row })
        for (const key of Object.keys(totals) as (keyof UsageTotals)[]) totals[key] += row[key]
      }
      const featureRows = db
        .prepare(`SELECT feature, ${SUMS} FROM usage_daily WHERE day >= ? GROUP BY feature`)
        .all(fromDay) as Row[]
      const byFeature = featureRows
        .map((r) => ({ feature: str(r.feature), ...totalsOf(r) }))
        .filter((r): r is UsageTotals & { feature: ModelUsageFeature } => isModelUsageFeature(r.feature))
        .sort(
          (a, b) =>
            b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
            MODEL_USAGE_FEATURES.indexOf(a.feature) - MODEL_USAGE_FEATURES.indexOf(b.feature),
        )
      const modelRows = db
        .prepare(
          `SELECT provider_id, model_id, MAX(local) AS local, ${SUMS} FROM usage_daily WHERE day >= ?
           GROUP BY provider_id, model_id`,
        )
        .all(fromDay) as Row[]
      const byModel = modelRows
        .map((r) => ({
          providerId: str(r.provider_id),
          modelId: str(r.model_id),
          local: num(r.local) === 1,
          ...totalsOf(r),
        }))
        .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
      return { from, to, totals, days: daysOut, byFeature, byModel }
    },

    listCalls({ limit, before, feature }) {
      const size = Math.max(1, Math.min(200, Math.floor(limit)))
      const where: string[] = []
      const params: Array<string | number> = []
      if (before) {
        where.push('(at < ? OR (at = ? AND id < ?))')
        params.push(before.at, before.at, before.id)
      }
      if (feature) {
        where.push('feature = ?')
        params.push(feature)
      }
      const rows = db
        .prepare(
          `SELECT ${CALL_COLUMNS} FROM calls ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY at DESC, id DESC LIMIT ?`,
        )
        .all(...params, size + 1) as Row[]
      return { items: rows.slice(0, size).map(callOf), hasMore: rows.length > size }
    },

    getCall(id) {
      const row = db
        .prepare(`SELECT ${CALL_COLUMNS}, error_message, request, response FROM calls WHERE id = ?`)
        .get(id) as Row | undefined
      if (!row) return null
      return {
        ...callOf(row),
        errorMessage: optStr(row.error_message),
        request: optStr(row.request),
        response: optStr(row.response),
      }
    },

    clearUsage() {
      db.exec('DELETE FROM usage_daily; DELETE FROM calls;')
    },
    clearCalls() {
      db.exec('DELETE FROM calls')
    },
    dropContent() {
      db.exec('UPDATE calls SET request = NULL, response = NULL WHERE request IS NOT NULL OR response IS NOT NULL')
    },
    close() {
      db.close()
    },
  }
}
