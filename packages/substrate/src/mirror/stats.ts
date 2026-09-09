import type { StatsQuery, StatsResult } from '@aiwc/protocol'
import { type Db, type SqlParam, num } from './db'

export interface StatsOps {
  stats(q: StatsQuery): StatsResult
}

const BUCKET_FORMAT: Record<NonNullable<StatsQuery['groupBy']>, string> = {
  hour: '%H',
  weekday: '%w',
  day: '%Y-%m-%d',
  month: '%Y-%m',
}

export function createStatsOps(db: Db): StatsOps {
  const where = (q: StatsQuery, alias = 'm'): { where: string; params: SqlParam[] } => {
    const clauses: string[] = []
    const params: SqlParam[] = []
    if (q.sessionId) {
      clauses.push(`${alias}.session_id = ?`)
      params.push(q.sessionId)
    }
    if (q.from !== undefined) {
      clauses.push(`${alias}.created_at >= ?`)
      params.push(q.from)
    }
    if (q.to !== undefined) {
      clauses.push(`${alias}.created_at <= ?`)
      params.push(q.to)
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
  }

  const overview = (q: StatsQuery): StatsResult => {
    const w = where(q)
    const base = db.get<{ total: number; self_count: number; sessions: number; active_days: number; first_at: number | null; last_at: number | null; media: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(m.is_self), 0) AS self_count,
              COUNT(DISTINCT m.session_id) AS sessions,
              COUNT(DISTINCT date(m.created_at / 1000, 'unixepoch', 'localtime')) AS active_days,
              MIN(m.created_at) AS first_at,
              MAX(m.created_at) AS last_at,
              COALESCE(SUM(CASE WHEN m.media_json IS NOT NULL THEN 1 ELSE 0 END), 0) AS media
       FROM messages m ${w.where}`,
      ...w.params,
    )
    const total = num(base?.total)
    const rows: StatsResult['rows'] = [
      { key: 'total', value: total },
      { key: 'self', value: num(base?.self_count) },
      { key: 'others', value: total - num(base?.self_count) },
      { key: 'sessions', value: num(base?.sessions) },
      { key: 'active_days', value: num(base?.active_days) },
      { key: 'media', value: num(base?.media) },
      { key: 'first_at', value: num(base?.first_at) },
      { key: 'last_at', value: num(base?.last_at) },
    ]
    const kinds = db.all<{ kind: string; c: number }>(`SELECT m.kind AS kind, COUNT(*) AS c FROM messages m ${w.where} GROUP BY m.kind ORDER BY c DESC`, ...w.params)
    for (const k of kinds) rows.push({ key: `kind:${k.kind}`, value: num(k.c) })
    return { metric: 'overview', rows, total }
  }

  const ranking = (q: StatsQuery): StatsResult => {
    const w = where(q)
    const limit = Math.max(1, Math.floor(q.limit ?? 10))
    const total = num(db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM messages m ${w.where}`, ...w.params)?.c)
    if (q.sessionId) {
      const rows = db.all<{ id: string; name: string; c: number; self_count: number }>(
        `SELECT m.sender_id AS id, COALESCE(MAX(NULLIF(m.sender_name, '')), m.sender_id) AS name, COUNT(*) AS c, MAX(m.is_self) AS self_count
         FROM messages m ${w.where} GROUP BY m.sender_id ORDER BY c DESC, id ASC LIMIT ?`,
        ...w.params,
        limit,
      )
      return {
        metric: 'ranking',
        total,
        rows: rows.map((r) => ({ id: r.id, name: r.name || r.id, count: num(r.c), isSelf: num(r.self_count), share: total ? Math.round((num(r.c) / total) * 1000) / 10 : 0 })),
      }
    }
    const rows = db.all<{ id: string; name: string | null; kind: string | null; c: number }>(
      `SELECT m.session_id AS id, s.title AS name, s.kind AS kind, COUNT(*) AS c
       FROM messages m LEFT JOIN sessions s ON s.id = m.session_id ${w.where} GROUP BY m.session_id ORDER BY c DESC, id ASC LIMIT ?`,
      ...w.params,
      limit,
    )
    return {
      metric: 'ranking',
      total,
      rows: rows.map((r) => ({ id: r.id, name: r.name || r.id, kind: r.kind ?? '', count: num(r.c), share: total ? Math.round((num(r.c) / total) * 1000) / 10 : 0 })),
    }
  }

  const timeDistribution = (q: StatsQuery): StatsResult => {
    const w = where(q)
    const groupBy = q.groupBy ?? 'day'
    const fmt = BUCKET_FORMAT[groupBy] ?? BUCKET_FORMAT.day
    const rows = db.all<{ b: string; c: number }>(
      `SELECT strftime('${fmt}', m.created_at / 1000, 'unixepoch', 'localtime') AS b, COUNT(*) AS c FROM messages m ${w.where} GROUP BY b ORDER BY b ASC`,
      ...w.params,
    )
    const counts = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      counts.set(String(r.b), num(r.c))
      total += num(r.c)
    }
    let buckets: string[]
    if (groupBy === 'hour') buckets = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
    else if (groupBy === 'weekday') buckets = Array.from({ length: 7 }, (_, i) => String(i))
    else buckets = [...counts.keys()]
    const limit = q.limit && q.limit > 0 ? Math.floor(q.limit) : undefined
    const out = buckets.map((b) => ({ bucket: b, count: counts.get(b) ?? 0 }))
    return { metric: 'time_distribution', total, rows: limit ? out.slice(-limit) : out }
  }

  return {
    stats(q) {
      switch (q.metric) {
        case 'overview':
          return overview(q)
        case 'ranking':
          return ranking(q)
        case 'time_distribution':
          return timeDistribution(q)
        default:
          return { metric: q.metric, rows: [], total: 0 }
      }
    },
  }
}
