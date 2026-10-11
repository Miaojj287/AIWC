/**
 * createTodoStore — 每日待办 on disk, under `dir`:
 *   items.json          { version: 1, items: TodoItem[] }   the checklist
 *   days/YYYY-MM-DD.json  TodoDay                           per-day chat summaries
 *   state.json          { version: 1, cursors, last }        where each chat's scan resumes + the last result
 *
 * Every file is validated on read (a bad item is skipped and logged, never the whole list); writes are
 * atomic and serialised per file (in-process mutex + sidecar lock). Scanned todos are de-duplicated
 * against the chat's recent items inside the same lock, so two scans cannot add the same ask twice.
 */
import {
  TodoDaySchema,
  TodoItemSchema,
  TodoScanResultSchema,
  isTodoDate,
  sortTodoItems,
  type Millis,
  type TodoChatSummary,
  type TodoDay,
  type TodoItem,
  type TodoScanResult,
} from '@aiwc/protocol'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { KeyedMutex, atomicWriteFile, ensureDir, listFiles, readJsonIfExists, withFileLock } from '../internal/fsx'
import { normaliseForCompare } from '../internal/text'
import type { SourceCursor } from './select'

/** Past this many items the oldest checked ones are dropped; open items are never dropped. */
export const TODO_MAX_ITEMS = 2000
/** A scanned todo matching an item of the same chat from this recent is a duplicate. */
const DEDUPE_WINDOW_MS = 14 * 24 * 3_600_000

type Logger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

/** Thrown by update() for an id that is not in the list (deleted in another window). */
export class TodoNotFoundError extends Error {
  readonly code = 'todo_not_found' as const
  constructor(id: string) {
    super(`todo not found: ${id}`)
    this.name = 'TodoNotFoundError'
  }
}

export type ScannedTodo = Omit<TodoItem, 'id' | 'origin' | 'createdAt' | 'done' | 'doneAt'>

export interface TodoScanState {
  cursors: Record<string, SourceCursor>
  last?: TodoScanResult
}

export interface TodoStore {
  readonly dir: string
  list(): Promise<TodoItem[]>
  add(text: string): Promise<TodoItem>
  /** Add what a scan found, skipping duplicates; resolves with the items actually added. */
  addScanned(items: readonly ScannedTodo[]): Promise<TodoItem[]>
  update(id: string, patch: { done?: boolean; text?: string }): Promise<TodoItem>
  remove(id: string): Promise<TodoItem | undefined>
  /** Put back an item removed a moment ago (撤销); an id already present is left alone. */
  restore(item: TodoItem): Promise<TodoItem>
  clearDone(): Promise<number>
  /** Dates with summaries, newest first. */
  days(): Promise<string[]>
  getDay(date: string): Promise<TodoDay | undefined>
  /** Replace the given chats' summaries in `date` (other chats of that day are kept). */
  mergeDay(date: string, chats: readonly TodoChatSummary[]): Promise<void>
  readState(): Promise<TodoScanState>
  writeState(state: TodoScanState): Promise<void>
}

const ItemsFileSchema = z.object({ version: z.literal(1), items: z.array(z.unknown()) })
const StateFileSchema = z.object({
  version: z.literal(1),
  cursors: z.record(z.string(), z.object({ seq: z.number(), at: z.number() })).catch({}),
  last: TodoScanResultSchema.optional().catch(undefined),
})

/** Duplicate key: normalised text without spaces or punctuation. */
export function todoKey(text: string): string {
  return normaliseForCompare(text).replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function createTodoStore(opts: { dir: string; now?: () => Millis; logger?: Logger }): TodoStore {
  const dir = opts.dir
  const now = opts.now ?? (() => Date.now())
  const log: Logger = opts.logger ?? (() => {})
  const itemsPath = join(dir, 'items.json')
  const statePath = join(dir, 'state.json')
  const daysDir = join(dir, 'days')
  const dayPath = (date: string) => join(daysDir, `${date}.json`)
  ensureDir(daysDir)
  const mutex = new KeyedMutex()

  const locked = <T>(path: string, fn: () => T | Promise<T>): Promise<T> =>
    mutex.run(path, () => withFileLock(path, fn))

  function readItems(): TodoItem[] {
    const parsed = ItemsFileSchema.safeParse(readJsonIfExists<unknown>(itemsPath))
    if (!parsed.success) return []
    const out: TodoItem[] = []
    for (const raw of parsed.data.items) {
      const item = TodoItemSchema.safeParse(raw)
      if (item.success) out.push(item.data)
      else log('warn', 'todo: skipped an unreadable item', { issues: item.error.issues.length })
    }
    return out
  }

  function writeItems(items: readonly TodoItem[]): void {
    const open = items.filter((i) => !i.done)
    const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    const kept = [...open, ...done.slice(0, Math.max(0, TODO_MAX_ITEMS - open.length))]
    atomicWriteFile(itemsPath, `${JSON.stringify({ version: 1, items: kept }, null, 2)}\n`)
  }

  const newId = () => randomUUID().replace(/-/g, '').slice(0, 20)

  const store: TodoStore = {
    dir,

    async list() {
      return sortTodoItems(readItems())
    },

    add(text) {
      const item = TodoItemSchema.parse({ id: newId(), text, origin: 'user', createdAt: now(), done: false })
      return locked(itemsPath, () => {
        writeItems([...readItems(), item])
        return item
      })
    },

    addScanned(found) {
      return locked(itemsPath, () => {
        const items = readItems()
        const at = now()
        const seen = new Set(
          items
            .filter((i) => i.origin === 'scan' && at - i.createdAt < DEDUPE_WINDOW_MS)
            .map((i) => `${i.sourceId ?? ''}\n${todoKey(i.text)}`),
        )
        const added: TodoItem[] = []
        for (const f of found) {
          const key = `${f.sourceId ?? ''}\n${todoKey(f.text)}`
          if (!todoKey(f.text) || seen.has(key)) continue
          seen.add(key)
          const parsed = TodoItemSchema.safeParse({ ...f, id: newId(), origin: 'scan', createdAt: at, done: false })
          if (parsed.success) added.push(parsed.data)
        }
        if (added.length) writeItems([...items, ...added])
        return added
      })
    },

    update(id, patch) {
      return locked(itemsPath, () => {
        const items = readItems()
        const index = items.findIndex((i) => i.id === id)
        const current = items[index]
        if (!current) throw new TodoNotFoundError(id)
        const next: TodoItem = { ...current }
        if (patch.text !== undefined) next.text = patch.text
        if (patch.done !== undefined && patch.done !== current.done) {
          next.done = patch.done
          if (patch.done) next.doneAt = now()
          else delete next.doneAt
        }
        const valid = TodoItemSchema.parse(next)
        items[index] = valid
        writeItems(items)
        return valid
      })
    },

    remove(id) {
      return locked(itemsPath, () => {
        const items = readItems()
        const removed = items.find((i) => i.id === id)
        if (removed) writeItems(items.filter((i) => i.id !== id))
        return removed
      })
    },

    restore(item) {
      const valid = TodoItemSchema.parse(item)
      return locked(itemsPath, () => {
        const items = readItems()
        const existing = items.find((i) => i.id === valid.id)
        if (existing) return existing
        writeItems([...items, valid])
        return valid
      })
    },

    clearDone() {
      return locked(itemsPath, () => {
        const items = readItems()
        const open = items.filter((i) => !i.done)
        if (open.length !== items.length) writeItems(open)
        return items.length - open.length
      })
    },

    async days() {
      return listFiles(daysDir)
        .map((name) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1])
        .filter((date): date is string => date !== undefined && isTodoDate(date))
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    },

    async getDay(date) {
      // The date becomes a path segment: only a well-formed date ever reaches join().
      if (!isTodoDate(date)) return undefined
      const parsed = TodoDaySchema.safeParse(readJsonIfExists<unknown>(dayPath(date)))
      if (parsed.success) return parsed.data
      return undefined
    },

    async mergeDay(date, chats) {
      if (!isTodoDate(date)) throw new Error(`invalid todo date: ${date}`)
      if (chats.length === 0) return
      await locked(dayPath(date), async () => {
        const current = await store.getDay(date)
        const replaced = new Set(chats.map((c) => c.sourceId))
        const kept = (current?.chats ?? []).filter((c) => !replaced.has(c.sourceId))
        const day = TodoDaySchema.parse({
          date,
          chats: [...kept, ...chats].sort((a, b) => b.updatedAt - a.updatedAt),
          updatedAt: now(),
        })
        atomicWriteFile(dayPath(date), `${JSON.stringify(day, null, 2)}\n`)
      })
    },

    async readState() {
      const parsed = StateFileSchema.safeParse(readJsonIfExists<unknown>(statePath))
      if (!parsed.success) return { cursors: {} }
      return { cursors: parsed.data.cursors, ...(parsed.data.last ? { last: parsed.data.last } : {}) }
    },

    writeState(state) {
      return locked(statePath, () =>
        atomicWriteFile(statePath, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`),
      )
    },
  }
  return store
}
