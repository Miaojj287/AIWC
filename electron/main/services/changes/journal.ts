/**
 * The change journal: what each Agent turn changed (workspace files, memory entries, skills, sent messages) and what
 * it takes to put it back. Append-only JSONL plus one blob per replaced file; bounded, compacted on open.
 *
 * Undo never overwrites work done since: a file is restored only while it still holds exactly what the Agent left,
 * a memory entry is removed only while it still reads the same. Otherwise the undo is refused with `conflict`.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { nanoid } from 'nanoid'
import type { AgentChange, MemoryFile, ThreadId, UndoChangeResult } from '@aiwc/protocol'
import { sha256 } from './workspaceCapture'

/** Entries kept per journal; older ones (and their blobs) are dropped when the file is compacted. */
export const JOURNAL_MAX_CHANGES = 2_000
/** Lines that trigger a compaction on open (undo markers make the file grow past the entry count). */
const JOURNAL_COMPACT_LINES = 4_000

/** How to reverse one change. Paths are relative to a named root and re-checked against it on undo. */
export type UndoPlan =
  | { type: 'file'; root: 'workspace' | 'skills'; path: string; blob?: string; afterHash?: string; dir?: boolean }
  | { type: 'memory-remove'; file: MemoryFile; text: string }
  | { type: 'memory-add'; file: MemoryFile; text: string; threadId: string }

export interface StoredChange extends AgentChange {
  plan?: UndoPlan
}

type JournalLine = ({ t: 'change' } & StoredChange) | { t: 'undone'; id: string; at: number }

export interface JournalUndoDeps {
  roots: { workspace: string; skills: () => string | undefined }
  /** Move a file or folder to the OS trash (recoverable), never a hard delete. */
  trash: (path: string) => Promise<void>
  memory: {
    entries(file: MemoryFile): Promise<Array<{ index: number; text: string }>>
    removeEntry(file: MemoryFile, index: number, expectedText?: string): Promise<void>
    addEntry(
      file: MemoryFile,
      text: string,
      opts?: { source?: 'agent'; threadId?: string },
    ): Promise<{ ok: boolean; reason?: string }>
  }
  /** After a skill file changed on disk. */
  refreshSkills?: () => Promise<void>
}

export interface ChangeJournal {
  /** Record one change; `blob` is the replaced content to keep for undo. Returns the stored change. */
  record(change: Omit<StoredChange, 'id' | 'undoneAt'>, blob?: Buffer): StoredChange
  list(threadId: ThreadId): AgentChange[]
  find(id: string): AgentChange | undefined
  undo(id: string): Promise<UndoChangeResult>
}

const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function createChangeJournal(opts: {
  dir: string
  undo: JournalUndoDeps
  now?: () => number
  logger?: (level: 'warn' | 'debug', msg: string, meta?: unknown) => void
}): ChangeJournal {
  const now = opts.now ?? Date.now
  const log = opts.logger ?? (() => {})
  const file = join(opts.dir, 'journal.jsonl')
  const blobDir = join(opts.dir, 'blobs')
  mkdirSync(blobDir, { recursive: true, mode: 0o700 })
  const changes = new Map<string, StoredChange>()
  load()

  function load(): void {
    if (!existsSync(file)) return
    let lines = 0
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      if (!raw.trim()) continue
      lines++
      try {
        const line = JSON.parse(raw) as JournalLine
        if (line.t === 'change' && typeof line.id === 'string') {
          const { t: _t, ...change } = line
          changes.set(line.id, change)
        } else if (line.t === 'undone') {
          const target = changes.get(line.id)
          if (target) target.undoneAt = line.at
        }
      } catch {
        log('warn', 'skipping a malformed change-journal line')
      }
    }
    if (lines > JOURNAL_COMPACT_LINES || changes.size > JOURNAL_MAX_CHANGES) compact()
  }

  function compact(): void {
    const kept = [...changes.values()].slice(-JOURNAL_MAX_CHANGES)
    changes.clear()
    for (const c of kept) changes.set(c.id, c)
    writeFileSync(file, kept.map((c) => JSON.stringify({ t: 'change', ...c })).join('\n') + '\n', { mode: 0o600 })
    const blobs = new Set(kept.flatMap((c) => (c.plan?.type === 'file' && c.plan.blob ? [c.plan.blob] : [])))
    for (const name of readdirSync(blobDir)) if (!blobs.has(name)) rmSync(join(blobDir, name), { force: true })
  }

  const append = (line: JournalLine): void => appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 })

  /** Resolve a plan path inside its root; undefined when it would escape (a tampered journal). */
  function locate(plan: Extract<UndoPlan, { type: 'file' }>): string | undefined {
    const root = plan.root === 'workspace' ? opts.undo.roots.workspace : opts.undo.roots.skills()
    if (!root) return undefined
    const base = resolve(root)
    const target = resolve(base, plan.path)
    return target.startsWith(base + sep) ? target : undefined
  }

  const currentHash = (path: string): string | undefined => {
    try {
      return sha256(readFileSync(path))
    } catch {
      return undefined
    }
  }

  async function undoFile(plan: Extract<UndoPlan, { type: 'file' }>): Promise<UndoChangeResult> {
    const target = locate(plan)
    if (!target) return { ok: false, reason: 'failed' }
    // A whole skill folder the Agent created: trash it while its SKILL.md is still what the Agent wrote.
    const probe = plan.dir ? join(target, 'SKILL.md') : target
    const present = currentHash(probe)
    if (plan.afterHash !== undefined && present !== plan.afterHash) return { ok: false, reason: 'conflict' }
    if (plan.afterHash === undefined && present !== undefined) return { ok: false, reason: 'conflict' }
    if (!plan.blob) {
      if (present !== undefined) await opts.undo.trash(target)
      return { ok: true }
    }
    const bytes = readFileSync(join(blobDir, plan.blob))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    return { ok: true }
  }

  async function undoMemory(plan: Exclude<UndoPlan, { type: 'file' }>): Promise<UndoChangeResult> {
    if (plan.type === 'memory-add') {
      const r = await opts.undo.memory.addEntry(plan.file, plan.text, { source: 'agent', threadId: plan.threadId })
      return r.ok ? { ok: true } : { ok: false, reason: 'conflict' }
    }
    const entries = await opts.undo.memory.entries(plan.file)
    const hit = entries.find((e) => normalise(e.text) === normalise(plan.text))
    if (!hit) return { ok: false, reason: 'conflict' }
    await opts.undo.memory.removeEntry(plan.file, hit.index, hit.text)
    return { ok: true }
  }

  return {
    record(change, blob) {
      const id = `chg_${nanoid(12)}`
      let plan = change.plan
      if (plan?.type === 'file' && blob) {
        const name = `${id}.bin`
        writeFileSync(join(blobDir, name), blob, { mode: 0o600 })
        plan = { ...plan, blob: name }
      }
      const stored: StoredChange = { ...change, id, ...(plan ? { plan } : {}) }
      changes.set(id, stored)
      append({ t: 'change', ...stored })
      return stored
    },

    list(threadId) {
      return [...changes.values()].filter((c) => c.threadId === threadId).map(({ plan: _plan, ...visible }) => visible)
    },

    find(id) {
      const change = changes.get(id)
      if (!change) return undefined
      const { plan: _plan, ...visible } = change
      return visible
    },

    async undo(id) {
      const change = changes.get(id)
      if (!change) return { ok: false, reason: 'not_found' }
      if (change.undoneAt !== undefined) return { ok: false, reason: 'already_undone' }
      if (!change.undoable || !change.plan) return { ok: false, reason: 'not_undoable' }
      let result: UndoChangeResult
      try {
        result = change.plan.type === 'file' ? await undoFile(change.plan) : await undoMemory(change.plan)
        if (result.ok && change.plan.type === 'file' && change.plan.root === 'skills') await opts.undo.refreshSkills?.()
      } catch (error) {
        log('warn', 'undo failed', { id, error: error instanceof Error ? error.message : String(error) })
        return { ok: false, reason: 'failed' }
      }
      if (!result.ok) return result
      change.undoneAt = now()
      append({ t: 'undone', id, at: change.undoneAt })
      return result
    },
  }
}
