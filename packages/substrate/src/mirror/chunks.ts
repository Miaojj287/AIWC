/**
 * Conversation chunking for embeddings (ported from AIWC_ORG messageVectorService.buildChunks).
 * Single WeChat messages are too short to embed; consecutive messages are grouped by a character
 * budget, a message cap and a time gap so one vector covers one stretch of conversation.
 */
export const CHUNK_MAX_CHARS = 600
export const CHUNK_MAX_MSGS = 15
export const CHUNK_GAP_MS = 20 * 60 * 1000
export const EMBED_TEXT_CAP = 1000
export const CHUNK_EXCERPT_CHARS = 240

export interface ChunkInput {
  seq: number
  createdAt: number
  /** Already formatted line, e.g. "张三: 今天三点开会". Empty lines are skipped. */
  text: string
}

export interface BuiltChunk {
  startSeq: number
  endSeq: number
  /** Middle message of the chunk: get_context(anchor, +-radius) covers the chunk symmetrically. */
  anchorSeq: number
  startAt: number
  endAt: number
  msgCount: number
  text: string
}

export function buildChunks(messages: readonly ChunkInput[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = []
  let group: ChunkInput[] = []
  let chars = 0

  const flush = () => {
    const first = group[0]
    const last = group[group.length - 1]
    if (!first || !last) return
    const mid = group[Math.floor(group.length / 2)] ?? first
    const joined = group.map((m) => m.text.trim()).filter(Boolean).join('\n')
    chunks.push({
      startSeq: first.seq,
      endSeq: last.seq,
      anchorSeq: mid.seq,
      startAt: first.createdAt,
      endAt: last.createdAt,
      msgCount: group.length,
      text: joined.slice(0, EMBED_TEXT_CAP),
    })
    group = []
    chars = 0
  }

  for (const m of messages) {
    const text = m.text.trim()
    if (!text) continue
    const prev = group[group.length - 1]
    if (prev) {
      const gap = m.createdAt - prev.createdAt
      if (chars + text.length > CHUNK_MAX_CHARS || group.length >= CHUNK_MAX_MSGS || gap > CHUNK_GAP_MS) flush()
    }
    group.push(m)
    chars += text.length
  }
  flush()
  return chunks
}

export function chunkExcerpt(text: string, max: number = CHUNK_EXCERPT_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
