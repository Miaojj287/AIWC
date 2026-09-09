/**
 * Rollout store: one append-only JSONL file per thread (source of truth) plus a node:sqlite index
 * for listing and full-text search. Appends go through a per-thread serial queue so lines never
 * interleave; flush() is the durability barrier.
 */
import { promises as fsp, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryItem, ItemId, JsonValue, ThreadId, ThreadOrigin, ThreadSettings } from '@aiwc/protocol'
import type { ResumeState, RolloutLine, RolloutStore } from '../ports'
import { openRolloutIndex, type RolloutIndex } from './rolloutIndex'

export interface RolloutStoreOptions {
  /** rollouts/ directory; created on demand */
  dir: string
  /** index.db path (node:sqlite) */
  indexDbPath: string
  clock?: () => number
}

export interface RolloutStoreExt extends RolloutStore {
  /** Path of a thread's JSONL file. */
  pathFor(threadId: ThreadId): string
  /** Always implemented here (optional on the port so other stores may omit it). */
  rewrite: NonNullable<RolloutStore['rewrite']>
  close(): Promise<void>
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

export function createRolloutStore(opts: RolloutStoreOptions): RolloutStoreExt {
  const now = opts.clock ?? (() => Date.now())
  let index: RolloutIndex | undefined
  const queues = new Map<ThreadId, Promise<void>>()

  const idx = (): RolloutIndex => (index ??= openRolloutIndex(opts.indexDbPath))
  const pathFor = (threadId: ThreadId): string => {
    if (!SAFE_ID.test(threadId)) throw new Error(`invalid thread id: ${threadId}`)
    return join(opts.dir, `${threadId}.jsonl`)
  }

  /** Chain `task` after everything already queued for the thread; the queue never rejects. */
  const enqueue = (threadId: ThreadId, task: () => Promise<void>): Promise<void> => {
    const prev = queues.get(threadId) ?? Promise.resolve()
    const run = prev.then(task)
    const settled = run.then(
      () => {},
      () => {},
    )
    queues.set(threadId, settled)
    void settled.then(() => {
      if (queues.get(threadId) === settled) queues.delete(threadId)
    })
    return run
  }

  const writeLines = (threadId: ThreadId, lines: RolloutLine[]): Promise<void> => {
    const payload = lines.map((l) => `${JSON.stringify(l)}\n`).join('')
    return enqueue(threadId, async () => {
      mkdirSync(opts.dir, { recursive: true })
      await fsp.appendFile(pathFor(threadId), payload, 'utf8')
    })
  }

  const indexLines = (threadId: ThreadId, lines: RolloutLine[], ts: number): void => {
    const db = idx()
    let itemCount = 0
    let settings: ThreadSettings | undefined
    for (const line of lines) {
      if (line.type === 'item') {
        itemCount++
        const text = textOf(line.item)
        if (text) db.indexText(threadId, line.item.id, line.item.createdAt, text)
      } else if (line.type === 'settings' || line.type === 'thread_meta') {
        settings = line.settings
      }
    }
    db.touch(threadId, { updatedAt: ts, itemCountDelta: itemCount, settings })
  }

  return {
    pathFor,

    async create(meta) {
      const ts = now()
      const line: RolloutLine = { ts, type: 'thread_meta', threadId: meta.threadId, origin: meta.origin, settings: meta.settings, title: meta.title }
      idx().insertThread({
        threadId: meta.threadId,
        origin: meta.origin,
        settings: meta.settings,
        title: meta.title ?? '',
        createdAt: ts,
        updatedAt: ts,
        pinned: false,
        archived: false,
        itemCount: 0,
      })
      await writeLines(meta.threadId, [line])
    },

    async append(threadId, lines) {
      if (lines.length === 0) return
      indexLines(threadId, lines, now())
      await writeLines(threadId, lines)
    },

    async flush(threadId) {
      await (queues.get(threadId) ?? Promise.resolve())
    },

    async resume(threadId) {
      await this.flush(threadId)
      let raw: string
      try {
        raw = await fsp.readFile(pathFor(threadId), 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw err
      }
      const state = replay(threadId, raw)
      if (!state) return undefined
      const rec = idx().getThread(threadId)
      if (rec) {
        state.title = rec.title || state.title
        state.settings = rec.settings ?? state.settings
      }
      return state
    },

    async list(listOpts) {
      return idx().list(listOpts)
    },

    async updateMeta(threadId, patch) {
      const ts = now()
      idx().updateMeta(threadId, patch, ts)
      if (patch.settings) await writeLines(threadId, [{ ts, type: 'settings', settings: patch.settings }])
    },

    async remove(threadId) {
      await this.flush(threadId)
      idx().remove(threadId)
      await fsp.rm(pathFor(threadId), { force: true })
    },

    async search(query, searchOpts) {
      return idx().search(query, searchOpts)
    },

    async rewrite(threadId, state) {
      const path = pathFor(threadId)
      await enqueue(threadId, async () => {
        const rec = idx().getThread(threadId)
        const prior = rec ? undefined : await readState(threadId, path)
        const origin = rec?.origin ?? prior?.state.origin
        if (!origin) throw new Error(`unknown thread: ${threadId}`)
        const ts = now()
        const createdAt = rec?.createdAt ?? prior?.createdAt ?? ts
        const title = rec?.title ?? prior?.state.title ?? ''
        const lines: RolloutLine[] = [{ ts: createdAt, type: 'thread_meta', threadId, origin, settings: state.settings, title: title || undefined }]
        // The checkpoint precedes the items: replay then keeps every live item and simply moves the
        // summary to the front, instead of dropping whatever sits before it.
        if (state.lastCompactedThroughId) {
          const summary = findSummary(state.items, state.lastCompactedThroughId)
          if (summary) lines.push({ ts, type: 'compacted', summaryItemId: summary.id, foldedThroughId: state.lastCompactedThroughId })
        }
        for (const item of state.items) lines.push({ ts, type: 'item', item })
        if (state.worldState) lines.push({ ts, type: 'world_state', snapshot: state.worldState })

        mkdirSync(opts.dir, { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        await fsp.writeFile(tmp, lines.map((l) => `${JSON.stringify(l)}\n`).join(''), 'utf8')
        await fsp.rename(tmp, path)

        const texts: Array<{ itemId: ItemId; ts: number; text: string }> = []
        for (const item of state.items) {
          const text = textOf(item)
          if (text) texts.push({ itemId: item.id, ts: item.createdAt, text })
        }
        idx().reindexThread(
          {
            threadId,
            origin,
            settings: state.settings,
            title,
            createdAt,
            updatedAt: ts,
            pinned: rec?.pinned ?? false,
            archived: rec?.archived ?? false,
            itemCount: state.items.length,
          },
          texts,
        )
      })
    },

    async close() {
      await Promise.all([...queues.values()])
      index?.close()
      index = undefined
    },
  }
}

/** Fallback for rewrite when the index has no row: replay the existing file and take its first ts as createdAt. */
async function readState(threadId: ThreadId, path: string): Promise<{ state: ResumeState; createdAt: number } | undefined> {
  let raw: string
  try {
    raw = await fsp.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
  const state = replay(threadId, raw)
  if (!state) return undefined
  const first = raw.split('\n').find((l) => l.trim())
  let createdAt = Date.now()
  try {
    const ts = (JSON.parse(first ?? '{}') as { ts?: unknown }).ts
    if (typeof ts === 'number') createdAt = ts
  } catch {
    /* torn first line: keep the fallback */
  }
  return { state, createdAt }
}

/** The compaction_summary that produced the checkpoint, else the latest summary in the live history. */
function findSummary(items: HistoryItem[], foldedThroughId: ItemId): HistoryItem | undefined {
  const summaries = items.filter((i) => i.type === 'compaction_summary')
  return summaries.find((i) => i.type === 'compaction_summary' && i.foldedThroughId === foldedThroughId) ?? summaries.at(-1)
}

/** user_message / assistant_message text fed to FTS. */
function textOf(item: HistoryItem): string | undefined {
  if (item.type === 'user_message') {
    const text = item.content
      .map((p) => (p.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
    return text || undefined
  }
  if (item.type === 'assistant_message') return item.text || undefined
  return undefined
}

/**
 * Replay a JSONL body. At each compaction checkpoint everything folded (through `foldedThroughId`)
 * is dropped and the compaction_summary item is placed first, followed by the verbatim tail that
 * compaction kept; corrupt lines (typically a torn trailing write) are skipped.
 */
export function replay(threadId: ThreadId, raw: string): ResumeState | undefined {
  let origin: ThreadOrigin | undefined
  let settings: ThreadSettings | undefined
  let title = ''
  let items: HistoryItem[] = []
  let lastCompactedThroughId: ItemId | undefined
  let pendingSummaryId: ItemId | undefined
  let worldState: Record<string, JsonValue> | undefined

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: RolloutLine
    try {
      parsed = JSON.parse(line) as RolloutLine
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') continue
    switch (parsed.type) {
      case 'thread_meta':
        origin = parsed.origin
        settings = parsed.settings
        if (parsed.title) title = parsed.title
        break
      case 'settings':
        settings = parsed.settings
        break
      case 'item':
        if (pendingSummaryId && parsed.item.id === pendingSummaryId) {
          items = [parsed.item, ...items]
          pendingSummaryId = undefined
        } else {
          items.push(parsed.item)
        }
        break
      case 'compacted': {
        lastCompactedThroughId = parsed.foldedThroughId
        const summaryItem = items.find((i) => i.id === parsed.summaryItemId)
        const foldAt = items.findIndex((i) => i.id === parsed.foldedThroughId)
        if (summaryItem) {
          // compactContext records the summary at the END of live history (after the tail that
          // selectCompactionSplit kept verbatim), so anchor on the fold point, never on the summary's
          // own position; the summary always leads the resumed history.
          const kept = foldAt >= 0 ? items.slice(foldAt + 1) : items.slice(items.indexOf(summaryItem))
          items = [summaryItem, ...kept.filter((i) => i.id !== summaryItem.id)]
        } else {
          // summary item not written yet: drop everything folded, keep whatever came after the fold point
          items = foldAt >= 0 ? items.slice(foldAt + 1) : []
          pendingSummaryId = parsed.summaryItemId
        }
        break
      }
      case 'world_state':
        worldState = parsed.snapshot
        break
      default:
        break
    }
  }

  if (!origin || !settings) return undefined
  return { items, settings, origin, title, lastCompactedThroughId, worldState }
}
