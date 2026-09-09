/**
 * Keyword search over two FTS5 indexes (unicode61 for latin / mixed tokens, trigram for CJK and
 * substrings), vector search over chunk embeddings (cosine in JS, cached in memory) and the lazy
 * chunk builder that feeds the vector index.
 */
import type { EmbeddingClient, SearchHit, WxMessage } from '@aiwc/protocol'
import { type Db, type SqlParam, num, placeholders } from './db'
import { type MessageRow, rowToMessage } from './rows'
import type { MessageOps } from './messages'
import type { EnsureChunksOptions, EnsureChunksResult, SearchFilters, VectorSearchHit } from './types'
import { buildChunks, chunkExcerpt, EMBED_TEXT_CAP } from './chunks'
import { isTextBearing } from '../normalize/preview'
import { SubstrateError, errorMessage } from '../shared/errors'
import { chunked } from '../shared/async'

const DEFAULT_SESSION_CAP = 1500
const EMBED_BATCH = 64
const LIKE_SCORE = 0.6
const HAN_RUN = /\p{Script=Han}+|[^\p{Script=Han}]+/gu
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export interface FtsQueries {
  unicode?: string
  trigram?: string
  like: string[]
}

const quote = (t: string) => `"${t.replace(/"/g, '""')}"`

/** Split a free-text query into per-index MATCH expressions plus LIKE fallbacks for terms too short for trigram. */
export function buildFtsQueries(query: string): FtsQueries {
  const unicode: string[] = []
  const trigram: string[] = []
  const like: string[] = []
  const tokens = String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  for (const token of tokens) {
    const runs = token.match(HAN_RUN) ?? [token]
    for (const run of runs) {
      const clean = run.replace(/["*]/g, '').trim()
      if (!clean) continue
      const cjk = CJK.test(clean)
      if (cjk) {
        if ([...clean].length >= 3) trigram.push(quote(clean))
        else like.push(clean)
      } else {
        const word = clean.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        if (!word) continue
        unicode.push([...word].length >= 2 ? `${quote(word)}*` : quote(word))
        if ([...word].length >= 3) trigram.push(quote(word))
      }
    }
  }
  const out: FtsQueries = { like }
  if (unicode.length) out.unicode = unicode.join(' ')
  if (trigram.length) out.trigram = trigram.join(' ')
  return out
}

interface RawHit {
  id: number
  created_at: number
  rank: number
  snip: string | null
}

interface Candidate {
  score: number
  snippet: string
  createdAt: number
}

function likeSnippet(text: string, terms: string[], width = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  let idx = -1
  let hit = ''
  for (const term of terms) {
    const i = t.toLowerCase().indexOf(term.toLowerCase())
    if (i !== -1 && (idx === -1 || i < idx)) {
      idx = i
      hit = term
    }
  }
  if (idx === -1) return t.slice(0, width)
  const start = Math.max(0, idx - Math.floor(width / 3))
  const end = Math.min(t.length, idx + hit.length + Math.floor(width / 2))
  const body = t.slice(start, end).replace(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), (m) => `[${m}]`)
  return `${start > 0 ? '…' : ''}${body}${end < t.length ? '…' : ''}`
}

interface VectorEntry {
  chunkId: number
  sessionId: string
  anchorSeq: number
  startSeq: number
  endSeq: number
  startAt: number
  endAt: number
  vec: Float32Array
  norm: number
}

function toFloat32(blob: unknown): Float32Array {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(0)
  const copy = new Uint8Array(u8.byteLength)
  copy.set(u8)
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

function fromNumbers(values: ArrayLike<number>): Float32Array {
  return values instanceof Float32Array ? values : Float32Array.from(Array.from(values))
}

function l2(v: Float32Array): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

export interface SearchOps {
  searchFts(query: string, opts: SearchFilters): SearchHit[]
  searchVector(queryVec: ArrayLike<number>, opts: SearchFilters): VectorSearchHit[]
  searchSemantic(query: string, opts: SearchFilters): Promise<VectorSearchHit[]>
  ensureChunks(sessionId: string, opts?: EnsureChunksOptions): Promise<EnsureChunksResult>
  invalidateVectorCache(): void
}

export function createSearchOps(db: Db, msgs: MessageOps, embeddings: EmbeddingClient | undefined): SearchOps {
  let vectorCache: VectorEntry[] | undefined

  const filterSql = (opts: SearchFilters, alias: string): { sql: string; params: SqlParam[] } => {
    const clauses: string[] = []
    const params: SqlParam[] = []
    if (opts.sessionIds?.length) {
      clauses.push(`${alias}.session_id IN (${placeholders(opts.sessionIds.length)})`)
      params.push(...opts.sessionIds)
    }
    if (opts.from !== undefined) {
      clauses.push(`${alias}.created_at >= ?`)
      params.push(opts.from)
    }
    if (opts.to !== undefined) {
      clauses.push(`${alias}.created_at <= ?`)
      params.push(opts.to)
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
  }

  const runFts = (table: 'messages_fts' | 'messages_fts_tri', match: string, opts: SearchFilters, fetch: number): RawHit[] => {
    const f = filterSql(opts, 'm')
    try {
      return db.all<RawHit>(
        `SELECT m.id AS id, m.created_at AS created_at, bm25(${table}) AS rank, snippet(${table}, 0, '[', ']', '…', 16) AS snip
         FROM ${table} JOIN messages m ON m.id = ${table}.rowid
         WHERE ${table} MATCH ?${f.sql}
         ORDER BY rank LIMIT ?`,
        match,
        ...f.params,
        fetch,
      )
    } catch {
      return []
    }
  }

  const runLike = (terms: string[], opts: SearchFilters, fetch: number): Array<RawHit & { text: string }> => {
    if (!terms.length) return []
    const f = filterSql(opts, 'm')
    const likeClauses = terms.map(() => "m.text LIKE ? ESCAPE '\\'").join(' AND ')
    const likeParams = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    return db.all<RawHit & { text: string }>(
      `SELECT m.id AS id, m.created_at AS created_at, 0 AS rank, NULL AS snip, m.text AS text
       FROM messages m WHERE ${likeClauses}${f.sql} ORDER BY m.created_at DESC LIMIT ?`,
      ...likeParams,
      ...f.params,
      fetch,
    )
  }

  const loadMessages = (ids: number[]): Map<number, WxMessage> => {
    const out = new Map<number, WxMessage>()
    for (const batch of chunked(ids, 200)) {
      const rows = db.all<MessageRow>(`SELECT * FROM messages WHERE id IN (${placeholders(batch.length)})`, ...batch)
      for (const r of rows) out.set(num(r.id), rowToMessage(r))
    }
    return out
  }

  const mergeInto = (acc: Map<number, Candidate>, hits: RawHit[], scoreOf: (h: RawHit, i: number) => number, snippetOf: (h: RawHit) => string) => {
    hits.forEach((h, i) => {
      const id = num(h.id)
      const cur = acc.get(id)
      const score = scoreOf(h, i)
      const snippet = snippetOf(h)
      if (cur) {
        cur.score += score
        if (!cur.snippet && snippet) cur.snippet = snippet
      } else acc.set(id, { score, snippet, createdAt: num(h.created_at) })
    })
  }

  const bm25Scores = (hits: RawHit[]): ((h: RawHit) => number) => {
    let max = 0
    for (const h of hits) max = Math.max(max, -num(h.rank))
    return (h) => (max > 0 ? -num(h.rank) / max : 1)
  }

  const searchFts = (query: string, opts: SearchFilters): SearchHit[] => {
    const limit = Math.max(1, Math.floor(opts.limit || 20))
    const q = buildFtsQueries(query)
    const fetch = limit * 3
    const acc = new Map<number, Candidate>()
    if (q.trigram) {
      const hits = runFts('messages_fts_tri', q.trigram, opts, fetch)
      mergeInto(acc, hits, bm25Scores(hits), (h) => h.snip ?? '')
    }
    if (q.unicode) {
      const hits = runFts('messages_fts', q.unicode, opts, fetch)
      mergeInto(acc, hits, bm25Scores(hits), (h) => h.snip ?? '')
    }
    if (q.like.length) {
      const hits = runLike(q.like, opts, fetch)
      mergeInto(acc, hits, () => LIKE_SCORE, (h) => likeSnippet((h as RawHit & { text: string }).text, q.like))
    }
    if (!acc.size) return []
    const ranked = [...acc.entries()].sort((a, b) => b[1].score - a[1].score || b[1].createdAt - a[1].createdAt).slice(0, limit)
    const messages = loadMessages(ranked.map(([id]) => id))
    const out: SearchHit[] = []
    for (const [id, c] of ranked) {
      const message = messages.get(id)
      if (!message) continue
      out.push({ message, score: c.score, snippet: c.snippet || chunkExcerpt(message.text, 120), source: 'fts' })
    }
    return out
  }

  const loadVectors = (): VectorEntry[] => {
    if (vectorCache) return vectorCache
    const rows = db.all<{ chunk_id: number; session_id: string; anchor_seq: number; start_seq: number; end_seq: number; start_at: number; end_at: number; dims: number; vec: Uint8Array }>(
      `SELECT v.chunk_id, c.session_id, c.anchor_seq, c.start_seq, c.end_seq, c.start_at, c.end_at, v.dims, v.vec
       FROM chunk_vectors v JOIN chunks c ON c.id = v.chunk_id`,
    )
    vectorCache = rows.map((r) => {
      const vec = toFloat32(r.vec)
      return {
        chunkId: num(r.chunk_id),
        sessionId: r.session_id,
        anchorSeq: num(r.anchor_seq),
        startSeq: num(r.start_seq),
        endSeq: num(r.end_seq),
        startAt: num(r.start_at),
        endAt: num(r.end_at),
        vec,
        norm: l2(vec),
      }
    })
    return vectorCache
  }

  const searchVector = (queryVec: ArrayLike<number>, opts: SearchFilters): VectorSearchHit[] => {
    const limit = Math.max(1, Math.floor(opts.limit || 20))
    const q = fromNumbers(queryVec)
    const qn = l2(q)
    if (!q.length || qn === 0) return []
    const sessions = opts.sessionIds?.length ? new Set(opts.sessionIds) : undefined
    const scored: Array<{ e: VectorEntry; score: number }> = []
    for (const e of loadVectors()) {
      if (e.vec.length !== q.length || e.norm === 0) continue
      if (sessions && !sessions.has(e.sessionId)) continue
      if (opts.from !== undefined && e.endAt < opts.from) continue
      if (opts.to !== undefined && e.startAt > opts.to) continue
      let dot = 0
      for (let i = 0; i < q.length; i++) dot += q[i]! * e.vec[i]!
      scored.push({ e, score: dot / (qn * e.norm) })
    }
    scored.sort((a, b) => b.score - a.score)
    const out: VectorSearchHit[] = []
    for (const { e, score } of scored) {
      if (out.length >= limit) break
      const message = msgs.getMessageBySeq(e.sessionId, e.anchorSeq)
      if (!message) continue
      const text = db.get<{ text: string }>('SELECT text FROM chunks WHERE id = ?', e.chunkId)?.text ?? message.text
      out.push({ message, score, snippet: chunkExcerpt(text), source: 'vector', range: { startSeq: e.startSeq, endSeq: e.endSeq } })
    }
    return out
  }

  const embedPending = async (sessionId: string, signal?: AbortSignal): Promise<{ embedded: number; pending: number; error?: string }> => {
    if (!embeddings) {
      const pending = num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE c.session_id = ? AND v.chunk_id IS NULL', sessionId)?.c)
      return { embedded: 0, pending }
    }
    let embedded = 0
    let error: string | undefined
    for (;;) {
      if (signal?.aborted) break
      const batch = db.all<{ id: number; text: string }>(
        `SELECT c.id, c.text FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id
         WHERE c.session_id = ? AND v.chunk_id IS NULL ORDER BY c.end_seq DESC LIMIT ?`,
        sessionId,
        EMBED_BATCH,
      )
      if (!batch.length) break
      let vectors: number[][]
      try {
        vectors = await embeddings.embed(batch.map((b) => b.text.slice(0, EMBED_TEXT_CAP)), signal)
      } catch (err) {
        error = errorMessage(err)
        break
      }
      if (vectors.length !== batch.length) {
        error = '嵌入结果数量与片段数量不一致'
        break
      }
      db.tx(() => {
        batch.forEach((b, i) => {
          const v = Float32Array.from(vectors[i] ?? [])
          if (!v.length) return
          const blob = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
          db.run('INSERT OR REPLACE INTO chunk_vectors (chunk_id, dims, model, vec) VALUES (?, ?, ?, ?)', b.id, v.length, embeddings.modelId, blob)
          embedded++
        })
      })
      vectorCache = undefined
    }
    const pending = num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE c.session_id = ? AND v.chunk_id IS NULL', sessionId)?.c)
    return error ? { embedded, pending, error } : { embedded, pending }
  }

  const ensureChunks = async (sessionId: string, opts?: EnsureChunksOptions): Promise<EnsureChunksResult> => {
    const cap = Math.max(1, Math.floor(opts?.maxMessages ?? DEFAULT_SESSION_CAP))
    const last = db.get<{ m: number | null }>('SELECT MAX(end_seq) AS m FROM chunks WHERE session_id = ?', sessionId)?.m
    type R = { seq: number; created_at: number; sender_id: string; sender_name: string | null; is_self: number; kind: string; text: string }
    let rows: R[]
    if (last !== null && last !== undefined) {
      rows = db.all<R>(`SELECT seq, created_at, sender_id, sender_name, is_self, kind, text FROM messages WHERE session_id = ? AND seq > ? AND text <> '' ORDER BY seq ASC`, sessionId, last)
    } else {
      rows = db.all<R>(`SELECT seq, created_at, sender_id, sender_name, is_self, kind, text FROM messages WHERE session_id = ? AND text <> '' ORDER BY seq DESC LIMIT ?`, sessionId, cap).reverse()
    }
    const inputs = rows
      .filter((r) => isTextBearing(r.kind as WxMessage['kind']))
      .map((r) => ({ seq: num(r.seq), createdAt: num(r.created_at), text: `${r.sender_name || (num(r.is_self) ? '我' : r.sender_id)}: ${r.text}` }))
    const built = buildChunks(inputs)
    if (built.length) {
      db.tx(() => {
        for (const c of built) {
          db.run(
            'INSERT INTO chunks (session_id, start_seq, end_seq, anchor_seq, start_at, end_at, msg_count, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            sessionId,
            c.startSeq,
            c.endSeq,
            c.anchorSeq,
            c.startAt,
            c.endAt,
            c.msgCount,
            c.text,
          )
        }
      })
    }
    if (opts?.chunkOnly) {
      const pending = num(db.get<{ c: number }>('SELECT COUNT(*) AS c FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE c.session_id = ? AND v.chunk_id IS NULL', sessionId)?.c)
      return { chunks: built.length, embedded: 0, pending }
    }
    const e = await embedPending(sessionId, opts?.signal)
    return e.error ? { chunks: built.length, embedded: e.embedded, pending: e.pending, error: e.error } : { chunks: built.length, embedded: e.embedded, pending: e.pending }
  }

  return {
    searchFts,
    searchVector,
    async searchSemantic(query, opts) {
      if (!embeddings) throw new SubstrateError('unsupported', '未配置嵌入模型，无法进行语义检索')
      const [vec] = await embeddings.embed([query])
      if (!vec) return []
      return searchVector(vec, opts)
    },
    ensureChunks,
    invalidateVectorCache() {
      vectorCache = undefined
    },
  }
}
