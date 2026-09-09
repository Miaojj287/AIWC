/**
 * createMemoryStore — four bounded Markdown files (MEMORY / USER / SOUL / AGENTS) under one directory.
 *
 * Guarantees:
 *  - every write is atomic (tmp + rename) and serialised by an in-process mutex + sidecar `.lock`
 *  - drift detection: the hash of the last content this store wrote is remembered; when the file on
 *    disk differs AND no longer round-trips through the parser, the mutation is refused (`blocked`)
 *    and a `.bak.<ts>` copy is taken so nothing is silently lost
 *  - budgets are character based (model independent); addEntry refuses `over_budget` and `duplicate`
 *  - snapshot() is the only render the kernel injects; it carries a usage header per file
 */
import type { MemoryBudget, MemoryEntry, MemoryFile, MemorySnapshot, MemoryStore } from '@aiwc/protocol'
import { join } from 'node:path'
import { KeyedMutex, atomicWriteFile, ensureDir, readJsonIfExists, readTextIfExists, sha256, withFileLock } from '../internal/fsx'
import { normaliseForCompare } from '../internal/text'
import {
  DEFAULT_MEMORY_LIMITS,
  MEMORY_FILES,
  joinEntries,
  parseEntries,
  renderSnapshotBlock,
  roundTrips,
  serializeEntries,
} from './format'
import { rankEntries } from './search'

export interface MemoryStoreOptions {
  dir: string
  limits?: Partial<Record<MemoryFile, number>>
  /** injectable clock (tests) */
  now?: () => number
}

type Source = NonNullable<MemoryEntry['source']>
type Listener = (e: { file: MemoryFile; source: MemoryEntry['source'] }) => void

interface EntryMeta {
  addedAt: number
  source: Source
}
interface MetaFile {
  /** sha256 of the last content this store wrote — survives restarts so a clean file is never flagged as drift */
  contentHash?: string
  entries: Record<string, EntryMeta>
}

/**
 * Rejection of replaceEntry / removeEntry when the on-disk file drifted (edited externally in a way a
 * rewrite could not preserve). Never a bare Error: `.file` names the memory file and `.bakPath` the
 * `<file>.md.bak.<ts>` copy taken before refusing, so the host can point the user at it.
 */
export class MemoryDriftError extends Error {
  readonly file: MemoryFile
  readonly bakPath: string
  constructor(file: MemoryFile, bakPath: string) {
    super(`${file}.md 在磁盘上被外部修改且无法安全重写，已备份到 ${bakPath}；请在设置里重新保存该文件后重试`)
    this.name = 'MemoryDriftError'
    this.file = file
    this.bakPath = bakPath
  }
}

export interface MemoryStoreExt extends MemoryStore {
  readonly dir: string
  limits(): Readonly<Record<MemoryFile, number>>
  pathFor(file: MemoryFile): string
}

const metaKey = (text: string) => sha256(normaliseForCompare(text)).slice(0, 24)

export function createMemoryStore(opts: MemoryStoreOptions): MemoryStoreExt {
  const dir = opts.dir
  const now = opts.now ?? (() => Date.now())
  const limits: Record<MemoryFile, number> = { ...DEFAULT_MEMORY_LIMITS }
  for (const f of MEMORY_FILES) {
    const v = opts.limits?.[f]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) limits[f] = Math.floor(v)
  }
  ensureDir(dir)

  const mutex = new KeyedMutex()
  const listeners = new Set<Listener>()

  const pathFor = (file: MemoryFile) => join(dir, `${file}.md`)
  const metaPath = (file: MemoryFile) => join(dir, `${file}.meta.json`)

  const readRaw = (file: MemoryFile): string => readTextIfExists(pathFor(file)) ?? ''
  const readMeta = (file: MemoryFile): MetaFile => {
    const m = readJsonIfExists<Partial<MetaFile>>(metaPath(file))
    return { ...(m?.contentHash ? { contentHash: m.contentHash } : {}), entries: m?.entries ?? {} }
  }
  const lastHash = new Map<MemoryFile, string>()
  for (const f of MEMORY_FILES) {
    const h = readMeta(f).contentHash
    if (h) lastHash.set(f, h)
  }

  const notify = (file: MemoryFile, source: Source) => {
    for (const l of listeners) {
      try {
        l({ file, source })
      } catch {
        /* listener errors never break a write */
      }
    }
  }

  /**
   * Load entries for mutation. When the file differs from what this store last wrote, it must still
   * look tool-shaped: it round-trips through the parser and no single entry exceeds the whole-file
   * budget (a tool can never write one that large — only an external free-form append can).
   * Otherwise the mutation is refused and a `.bak.<ts>` snapshot is taken.
   */
  const loadForMutation = (file: MemoryFile): { entries: string[] } | { blocked: string } => {
    const raw = readRaw(file)
    const entries = parseEntries(raw)
    if (raw.trim() !== '' && lastHash.get(file) !== sha256(raw)) {
      const oversize = entries.some((e) => e.length > limits[file])
      if (oversize || !roundTrips(raw)) {
        const bak = `${pathFor(file)}.bak.${now()}`
        atomicWriteFile(bak, raw)
        return { blocked: bak }
      }
    }
    return { entries }
  }

  const persist = (file: MemoryFile, entries: string[], source: Source, touched: readonly string[]) => {
    const content = serializeEntries(entries)
    atomicWriteFile(pathFor(file), content)
    const contentHash = sha256(content)
    lastHash.set(file, contentHash)
    // prune / extend sidecar metadata
    const meta = readMeta(file)
    const keep: Record<string, EntryMeta> = {}
    const ts = now()
    for (const text of entries) {
      const k = metaKey(text)
      const prev = meta.entries[k]
      keep[k] = prev ?? { addedAt: ts, source }
    }
    for (const text of touched) {
      const k = metaKey(text)
      if (keep[k]) keep[k] = { addedAt: ts, source }
    }
    const nextMeta: MetaFile = { contentHash, entries: keep }
    atomicWriteFile(metaPath(file), JSON.stringify(nextMeta, null, 2) + '\n')
    notify(file, source)
  }

  const locked = <T>(file: MemoryFile, fn: () => T | Promise<T>): Promise<T> =>
    mutex.run(file, () => withFileLock(pathFor(file), fn))

  const entriesOf = (file: MemoryFile): MemoryEntry[] => {
    const meta = readMeta(file)
    return parseEntries(readRaw(file)).map((text, index) => {
      const m = meta.entries[metaKey(text)]
      return m ? { index, text, addedAt: m.addedAt, source: m.source } : { index, text }
    })
  }

  const budgetOf = (file: MemoryFile): MemoryBudget => ({
    file,
    usedChars: joinEntries(parseEntries(readRaw(file))).length,
    limitChars: limits[file],
  })

  const store: MemoryStoreExt = {
    dir,
    limits: () => ({ ...limits }),
    pathFor,

    async read(file) {
      return readRaw(file)
    },

    async write(file, markdown, o) {
      const source: Source = o?.source ?? 'user'
      await locked(file, () => {
        const entries = parseEntries(markdown)
        persist(file, entries, source, entries)
      })
    },

    async entries(file) {
      return entriesOf(file)
    },

    async addEntry(file, text, o) {
      const source: Source = o?.source ?? 'agent'
      const clean = text.replace(/\r\n/g, '\n').trim()
      if (!clean) return { ok: false, reason: 'duplicate' }
      return locked(file, () => {
        const loaded = loadForMutation(file)
        if ('blocked' in loaded) return { ok: false as const, reason: 'blocked' as const }
        const entries = loaded.entries
        const norm = normaliseForCompare(clean)
        if (entries.some((e) => normaliseForCompare(e) === norm)) return { ok: false as const, reason: 'duplicate' as const }
        const next = [...entries, clean]
        if (joinEntries(next).length > limits[file]) return { ok: false as const, reason: 'over_budget' as const }
        persist(file, next, source, [clean])
        return { ok: true as const }
      })
    },

    async replaceEntry(file, index, text) {
      const clean = text.replace(/\r\n/g, '\n').trim()
      if (!clean) throw new Error('替换内容不能为空；要删除请用 removeEntry')
      await locked(file, () => {
        const loaded = loadForMutation(file)
        if ('blocked' in loaded) throw new MemoryDriftError(file, loaded.blocked)
        const entries = loaded.entries
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
          throw new RangeError(`条目序号越界：${index}（共 ${entries.length} 条）`)
        }
        const next = entries.slice()
        next[index] = clean
        if (joinEntries(next).length > limits[file]) {
          throw new Error(`超出 ${file} 的字数上限（${joinEntries(next).length}/${limits[file]} 字）`)
        }
        persist(file, next, 'user', [clean])
      })
    },

    async removeEntry(file, index) {
      await locked(file, () => {
        const loaded = loadForMutation(file)
        if ('blocked' in loaded) throw new MemoryDriftError(file, loaded.blocked)
        const entries = loaded.entries
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
          throw new RangeError(`条目序号越界：${index}（共 ${entries.length} 条）`)
        }
        const next = entries.filter((_, i) => i !== index)
        persist(file, next, 'user', [])
      })
    },

    async budget(file) {
      return budgetOf(file)
    },

    async snapshot(): Promise<MemorySnapshot> {
      const files = {} as Record<MemoryFile, string>
      const budgets: MemoryBudget[] = []
      for (const f of MEMORY_FILES) {
        const entries = parseEntries(readRaw(f))
        files[f] = renderSnapshotBlock(f, entries, limits[f])
        budgets.push({ file: f, usedChars: joinEntries(entries).length, limitChars: limits[f] })
      }
      return { takenAt: now(), files, budgets }
    },

    async search(query, limit = 10) {
      const q = query.trim()
      if (!q) return []
      const hits: Array<{ file: MemoryFile; entry: MemoryEntry; score: number }> = []
      for (const f of ['MEMORY', 'USER'] as const) {
        const entries = entriesOf(f)
        for (const r of rankEntries(entries.map((e) => e.text), q)) {
          const entry = entries[r.index]
          if (entry) hits.push({ file: f, entry, score: r.score })
        }
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit))
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return store
}
