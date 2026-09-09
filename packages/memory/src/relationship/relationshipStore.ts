/**
 * createRelationshipStore — one folder per contact under `dir`:
 *   <contactId>/profile.json      card + deep + stats + version + role (no samples / corrections)
 *   <contactId>/samples.jsonl     PersonaSample per line (replaced on every upsert)
 *   <contactId>/pairs.jsonl       PersonaPair per line: the bulk retrieval corpus, replaced on rebuild
 *   <contactId>/notes.jsonl       PersonaNote per line: director's notes, append-only, capped per kind
 *   <contactId>/reflected.json    threadId → messages already reflected on (so reflection is not redone)
 *   <contactId>/corrections.jsonl user corrections, append-only; merged (never dropped) on upsert
 *   <contactId>/status.json       CloneStatus + displayName so list() works without a profile
 *
 * A `building` status left behind by a crashed process is reported as `failed` on the next launch.
 */
import type { CloneStatus, PersonaNote, PersonaPair, PersonaSample, RelationshipProfile, RelationshipStore } from '@aiwc/protocol'
import { join } from 'node:path'
import { KeyedMutex, atomicWriteFile, ensureDir, listDirs, readJsonIfExists, removeTree, withFileLock } from '../internal/fsx'
import { appendJsonl, readJsonl, writeJsonl } from '../internal/jsonl'

export type RelationshipCorrection = RelationshipProfile['corrections'][number]

type StoredProfile = Omit<RelationshipProfile, 'samples' | 'corrections'>

/** Notes are injected into every persona turn, so they are capped hard per kind (newest wins). */
export const MAX_CORRECTION_NOTES = 20
export const MAX_EPISODE_NOTES = 8

interface StatusFile {
  contactId: string
  displayName: string
  status: CloneStatus
  updatedAt: number
}

type Listener = (e: { contactId: string; status: CloneStatus }) => void

export interface RelationshipStoreExt extends RelationshipStore {
  readonly dir: string
  /** Persist an intermediate status (building / failed) so the list survives restarts. */
  setStatus(contactId: string, status: CloneStatus, displayName?: string): Promise<void>
  appendCorrection(contactId: string, correction: RelationshipCorrection): Promise<void>
  listCorrections(contactId: string): Promise<RelationshipCorrection[]>
  /** Explicitly drop corrections (the only way they are ever lost). */
  clearCorrections(contactId: string): Promise<void>
  replacePairs(contactId: string, pairs: readonly PersonaPair[]): Promise<void>
  listPairs(contactId: string): Promise<PersonaPair[]>
  addNotes(contactId: string, notes: readonly Omit<PersonaNote, 'at'>[], at?: number): Promise<void>
  listNotes(contactId: string): Promise<PersonaNote[]>
  removeNote(contactId: string, at: number): Promise<void>
  getReflected(contactId: string, threadId: string): Promise<number>
  setReflected(contactId: string, threadId: string, count: number): Promise<void>
}

/** Folder name safe on every filesystem; the real id lives inside the JSON files. */
export function folderNameFor(contactId: string): string {
  return contactId.replace(/[^A-Za-z0-9_.@-]/g, (c) => `%${c.codePointAt(0)?.toString(16).padStart(2, '0') ?? ''}`) || '_'
}

const correctionKey = (c: RelationshipCorrection) => `${c.at}|${c.field}|${c.from}|${c.to}`

export function createRelationshipStore(opts: { dir: string; now?: () => number }): RelationshipStoreExt {
  const dir = opts.dir
  const now = opts.now ?? (() => Date.now())
  const openedAt = now()
  ensureDir(dir)
  const mutex = new KeyedMutex()
  const listeners = new Set<Listener>()

  const folder = (id: string) => join(dir, folderNameFor(id))
  const profilePath = (id: string) => join(folder(id), 'profile.json')
  const samplesPath = (id: string) => join(folder(id), 'samples.jsonl')
  const correctionsPath = (id: string) => join(folder(id), 'corrections.jsonl')
  const statusPath = (id: string) => join(folder(id), 'status.json')
  const pairsPath = (id: string) => join(folder(id), 'pairs.jsonl')
  const notesPath = (id: string) => join(folder(id), 'notes.jsonl')
  const reflectedPath = (id: string) => join(folder(id), 'reflected.json')

  const notify = (contactId: string, status: CloneStatus) => {
    for (const l of listeners) {
      try {
        l({ contactId, status })
      } catch {
        /* ignore */
      }
    }
  }

  const locked = <T>(id: string, fn: () => T | Promise<T>) => mutex.run(id, () => withFileLock(folder(id), fn))

  const readProfile = (id: string) => readJsonIfExists<StoredProfile>(profilePath(id))
  const readStatusFile = (id: string) => readJsonIfExists<StatusFile>(statusPath(id))

  const writeStatus = (id: string, status: CloneStatus, displayName: string) => {
    const row: StatusFile = { contactId: id, displayName, status, updatedAt: now() }
    atomicWriteFile(statusPath(id), JSON.stringify(row, null, 2) + '\n')
  }

  const readCorrections = (id: string) => readJsonl<RelationshipCorrection>(correctionsPath(id))

  /** Effective status, healing a stale `building` left by a previous process. */
  const resolveStatus = (id: string): { status: CloneStatus; displayName: string } => {
    const sf = readStatusFile(id)
    const profile = readProfile(id)
    const displayName = sf?.displayName || profile?.displayName || id
    if (sf) {
      if (sf.status.state === 'building' && sf.status.progress.startedAt < openedAt) {
        const failed: CloneStatus = { state: 'failed', error: '上次克隆未完成（应用已退出）', kind: 'unknown' }
        writeStatus(id, failed, displayName)
        return { status: failed, displayName }
      }
      return { status: sf.status, displayName }
    }
    if (profile) {
      const samples = readJsonl<PersonaSample>(samplesPath(id))
      return { status: { state: 'ready', version: profile.version, sampleCount: samples.length, builtAt: profile.updatedAt }, displayName }
    }
    return { status: { state: 'none', messageCount: 0 }, displayName }
  }

  const store: RelationshipStoreExt = {
    dir,

    async list() {
      const out: Array<{ contactId: string; status: CloneStatus; displayName: string }> = []
      for (const name of listDirs(dir)) {
        const sf = readJsonIfExists<StatusFile>(join(dir, name, 'status.json'))
        const profile = readJsonIfExists<StoredProfile>(join(dir, name, 'profile.json'))
        const contactId = sf?.contactId ?? profile?.contactId
        if (!contactId) continue
        const r = resolveStatus(contactId)
        out.push({ contactId, status: r.status, displayName: r.displayName })
      }
      return out
    },

    async get(contactId) {
      const profile = readProfile(contactId)
      if (!profile) return undefined
      return {
        ...profile,
        samples: readJsonl<PersonaSample>(samplesPath(contactId)),
        corrections: readCorrections(contactId),
      }
    },

    async status(contactId) {
      return resolveStatus(contactId).status
    },

    async upsert(profile) {
      const id = profile.contactId
      if (!id) throw new Error('contactId 不能为空')
      const status = await locked(id, () => {
        ensureDir(folder(id))
        const stored: StoredProfile = {
          contactId: id,
          displayName: profile.displayName,
          card: profile.card,
          deep: profile.deep,
          version: profile.version,
          updatedAt: profile.updatedAt,
          role: profile.role,
          ...(profile.stats ? { stats: profile.stats } : {}),
        }
        atomicWriteFile(profilePath(id), JSON.stringify(stored, null, 2) + '\n')
        writeJsonl(samplesPath(id), profile.samples)
        // corrections are append-only: union of what is on disk and what the caller passed
        const merged = new Map<string, RelationshipCorrection>()
        for (const c of readCorrections(id)) merged.set(correctionKey(c), c)
        for (const c of profile.corrections) merged.set(correctionKey(c), c)
        writeJsonl(correctionsPath(id), [...merged.values()].sort((a, b) => a.at - b.at))
        const st: CloneStatus = { state: 'ready', version: profile.version, sampleCount: profile.samples.length, builtAt: profile.updatedAt }
        writeStatus(id, st, profile.displayName)
        return st
      })
      notify(id, status)
    },

    async remove(contactId) {
      await locked(contactId, () => removeTree(folder(contactId)))
      notify(contactId, { state: 'none', messageCount: 0 })
    },

    async setStatus(contactId, status, displayName) {
      await locked(contactId, () => {
        ensureDir(folder(contactId))
        const name = displayName ?? readStatusFile(contactId)?.displayName ?? readProfile(contactId)?.displayName ?? contactId
        writeStatus(contactId, status, name)
      })
      notify(contactId, status)
    },

    async appendCorrection(contactId, correction) {
      await locked(contactId, () => {
        ensureDir(folder(contactId))
        appendJsonl(correctionsPath(contactId), correction)
      })
    },

    async listCorrections(contactId) {
      return readCorrections(contactId)
    },

    async clearCorrections(contactId) {
      await locked(contactId, () => writeJsonl(correctionsPath(contactId), []))
    },

    async replacePairs(contactId, pairs) {
      await locked(contactId, () => {
        ensureDir(folder(contactId))
        writeJsonl(pairsPath(contactId), pairs)
      })
    },

    async listPairs(contactId) {
      return readJsonl<PersonaPair>(pairsPath(contactId))
    },

    /** Append + cap per kind. Corrections steer every future reply, so an unbounded file would slowly eat the prompt. */
    async addNotes(contactId, notes, at) {
      const items = notes.map((n, i) => ({ at: (at ?? now()) + i, kind: n.kind, text: n.text.trim() })).filter((n) => n.text)
      if (items.length === 0) return
      await locked(contactId, () => {
        ensureDir(folder(contactId))
        const all = [...readJsonl<PersonaNote>(notesPath(contactId)), ...items].sort((a, b) => a.at - b.at)
        const keep = new Set<PersonaNote>()
        for (const kind of ['correction', 'episode'] as const) {
          const cap = kind === 'correction' ? MAX_CORRECTION_NOTES : MAX_EPISODE_NOTES
          for (const n of all.filter((x) => x.kind === kind).slice(-cap)) keep.add(n)
        }
        writeJsonl(notesPath(contactId), all.filter((n) => keep.has(n)))
      })
    },

    async listNotes(contactId) {
      return readJsonl<PersonaNote>(notesPath(contactId))
    },

    async removeNote(contactId, at) {
      await locked(contactId, () => {
        const rows = readJsonl<PersonaNote>(notesPath(contactId)).filter((n) => n.at !== at)
        writeJsonl(notesPath(contactId), rows)
      })
    },

    async getReflected(contactId, threadId) {
      return Number(readJsonIfExists<Record<string, number>>(reflectedPath(contactId))?.[threadId] ?? 0)
    },

    async setReflected(contactId, threadId, count) {
      await locked(contactId, () => {
        ensureDir(folder(contactId))
        const map = readJsonIfExists<Record<string, number>>(reflectedPath(contactId)) ?? {}
        map[threadId] = count
        atomicWriteFile(reflectedPath(contactId), JSON.stringify(map, null, 2) + '\n')
      })
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
