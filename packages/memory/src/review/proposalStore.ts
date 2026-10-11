/**
 * Memory proposals (设置 › 记忆 › 待确认): entries waiting for the user before they reach a memory file.
 *
 * One JSON file (`proposals.json` next to the memory files) holds the pending list plus, per Agent thread, how
 * many user messages the idle extraction has already read (so a thread is never distilled twice). Writes are
 * atomic and serialised; a file that fails validation is read as empty (logged by the host), never thrown.
 * Accepting goes through the MemoryStore, so its lock, drift check, character budget and entry cap all apply.
 */
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import {
  MEMORY_PROPOSALS_MAX,
  MEMORY_PROPOSAL_MAX_CHARS,
  MemoryProposalSchema,
  type MemoryProposal,
  type MemoryProposalAcceptRequest,
  type MemoryProposalAcceptResult,
  type MemoryProposalFile,
  type MemoryProposalOrigin,
  type MemoryStore,
} from '@aiwc/protocol'
import { KeyedMutex, atomicWriteFile, ensureDir, readJsonIfExists } from '../internal/fsx'
import { normaliseForCompare } from '../internal/text'

/** Threads whose extraction watermark is kept; the oldest are forgotten beyond this. */
const MAX_WATERMARKS = 500
const FILE_NAME = 'proposals.json'

const WatermarkSchema = z.object({ userMessages: z.number().int().nonnegative(), at: z.number().int().nonnegative() })
const FileSchema = z.object({
  items: z.array(z.unknown()).default([]),
  extracted: z.record(z.string(), WatermarkSchema).catch({}).default({}),
})

export interface NewMemoryProposal {
  file: MemoryProposalFile
  text: string
  origin: MemoryProposalOrigin
  threadId?: string
  threadTitle?: string
}

export type AddProposalResult = { ok: true; proposal: MemoryProposal } | { ok: false; reason: 'duplicate' | 'full' }

export interface MemoryProposalStore {
  /** Pending proposals, newest first. */
  list(): MemoryProposal[]
  add(input: NewMemoryProposal): Promise<AddProposalResult>
  /** Remove by id; returns how many were removed. */
  remove(ids: readonly string[]): Promise<number>
  /** Write one proposal through `memory` (the user confirmed it); removed when written or already present. */
  accept(memory: Pick<MemoryStore, 'addEntry'>, req: MemoryProposalAcceptRequest): Promise<MemoryProposalAcceptResult>
  /** User messages of `threadId` the extraction has already read. */
  extractedCount(threadId: string): number
  markExtracted(threadId: string, userMessages: number): Promise<void>
  /** Called with the whole pending list after every change, plus what was just added (if anything). */
  subscribe(listener: (items: MemoryProposal[], added: readonly MemoryProposal[]) => void): () => void
}

export interface MemoryProposalStoreOptions {
  dir: string
  now?: () => number
  /** Reports a proposals file that failed validation (it is read as empty). */
  onCorrupt?: (detail: string) => void
}

interface State {
  items: MemoryProposal[]
  extracted: Record<string, z.infer<typeof WatermarkSchema>>
}

export function createMemoryProposalStore(opts: MemoryProposalStoreOptions): MemoryProposalStore {
  const now = opts.now ?? (() => Date.now())
  ensureDir(opts.dir)
  const path = join(opts.dir, FILE_NAME)
  const mutex = new KeyedMutex()
  const listeners = new Set<(items: MemoryProposal[], added: readonly MemoryProposal[]) => void>()

  const load = (): State => {
    const raw = readJsonIfExists<unknown>(path)
    if (raw === undefined) return { items: [], extracted: {} }
    const parsed = FileSchema.safeParse(raw)
    if (!parsed.success) {
      opts.onCorrupt?.('proposals file has the wrong shape')
      return { items: [], extracted: {} }
    }
    const items: MemoryProposal[] = []
    for (const item of parsed.data.items) {
      const one = MemoryProposalSchema.safeParse(item)
      if (one.success) items.push(one.data)
      else opts.onCorrupt?.('skipped an invalid proposal')
    }
    return { items, extracted: parsed.data.extracted }
  }
  let state = load()

  const save = (next: State, added: readonly MemoryProposal[] = []) => {
    state = next
    atomicWriteFile(path, JSON.stringify(next, null, 2) + '\n')
    const items = sorted(next.items)
    for (const l of listeners) {
      try {
        l(items, added)
      } catch {
        /* a listener never breaks a write */
      }
    }
  }

  const locked = <T>(fn: () => T): Promise<T> => mutex.run(FILE_NAME, async () => fn())
  const sorted = (items: readonly MemoryProposal[]) => [...items].sort((a, b) => b.createdAt - a.createdAt)

  return {
    list: () => sorted(state.items),

    add(input) {
      return locked((): AddProposalResult => {
        const text = input.text.replace(/\r\n/g, '\n').trim().slice(0, MEMORY_PROPOSAL_MAX_CHARS)
        const norm = normaliseForCompare(text)
        if (!norm || state.items.some((p) => normaliseForCompare(p.text) === norm))
          return { ok: false, reason: 'duplicate' }
        if (state.items.length >= MEMORY_PROPOSALS_MAX) return { ok: false, reason: 'full' }
        const proposal: MemoryProposal = {
          id: `mp_${nanoid(12)}`,
          file: input.file,
          text,
          origin: input.origin,
          createdAt: now(),
          ...(input.threadId ? { threadId: input.threadId.slice(0, 64) } : {}),
          ...(input.threadTitle ? { threadTitle: input.threadTitle.slice(0, 200) } : {}),
        }
        save({ ...state, items: [...state.items, proposal] }, [proposal])
        return { ok: true, proposal }
      })
    },

    remove(ids) {
      return locked(() => {
        const drop = new Set(ids)
        const items = state.items.filter((p) => !drop.has(p.id))
        const removed = state.items.length - items.length
        if (removed > 0) save({ ...state, items })
        return removed
      })
    },

    accept(memory, req) {
      return mutex.run(FILE_NAME, async (): Promise<MemoryProposalAcceptResult> => {
        const proposal = state.items.find((p) => p.id === req.id)
        if (!proposal) return { ok: false, reason: 'not_found' }
        const file = req.file ?? proposal.file
        const text = req.text ?? proposal.text
        // 'user': the person confirmed this entry; the Agent only proposed it.
        const r = await memory.addEntry(file, text, { source: 'user', threadId: proposal.threadId })
        if (r.ok || r.reason === 'duplicate') save({ ...state, items: state.items.filter((p) => p.id !== req.id) })
        if (r.ok) return { ok: true }
        return { ok: false, reason: r.reason ?? 'blocked' }
      })
    },

    extractedCount: (threadId) => state.extracted[threadId]?.userMessages ?? 0,

    markExtracted(threadId, userMessages) {
      return locked(() => {
        const extracted = { ...state.extracted, [threadId]: { userMessages, at: now() } }
        const keys = Object.keys(extracted)
        if (keys.length > MAX_WATERMARKS) {
          const oldest = keys.sort((a, b) => (extracted[a]?.at ?? 0) - (extracted[b]?.at ?? 0))
          for (const k of oldest.slice(0, keys.length - MAX_WATERMARKS)) delete extracted[k]
        }
        state = { ...state, extracted }
        atomicWriteFile(path, JSON.stringify(state, null, 2) + '\n')
      })
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
