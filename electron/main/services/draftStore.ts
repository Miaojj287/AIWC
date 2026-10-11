/**
 * Unsent Agent composer drafts, kept in one JSON file under the data root so a draft survives a restart
 * (composer:loadDrafts / composer:saveDraft). The renderer debounces typing; here every save updates the in-memory
 * map and schedules one coalesced atomic write. Bounded: at most MAX_DRAFTS entries, and when the file would grow past
 * MAX_FILE_BYTES the oldest drafts drop their attachments first, then whole drafts go, oldest first.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { checkAttachments, MAX_QUOTED_MESSAGES, type ComposerDraftRecord } from '@aiwc/protocol'
import type { Logger } from '../log'

export const MAX_DRAFTS = 50
const MAX_FILE_BYTES = 24 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const MAX_KEY_CHARS = 128

const shortText = z.string().max(2_000)
const attachmentPart = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('image'), mediaType: shortText, data: z.string(), name: shortText.optional() }),
  z.strictObject({ type: z.literal('file'), mediaType: shortText, data: z.string(), name: shortText }),
])
/** One draft as the renderer sends it (also what the file holds); oversize attachment sets are rejected. */
export const draftRecordSchema = z.strictObject({
  text: z.string().max(MAX_TEXT_CHARS),
  mentions: z
    .array(
      z.strictObject({
        kind: z.enum(['session', 'file', 'contact', 'memory']),
        id: shortText,
        label: shortText,
        messageIds: z.array(z.string().max(128)).max(MAX_QUOTED_MESSAGES).optional(),
      }),
    )
    .max(100),
  attachments: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        part: attachmentPart,
        pasted: z.strictObject({ chars: z.number().int().min(0), lines: z.number().int().min(0) }).optional(),
      }),
    )
    .superRefine((list, ctx) => {
      if (checkAttachments(list.map((a) => a.part))) ctx.addIssue({ code: 'custom', message: 'attachments over limit' })
    }),
})
export const draftKeySchema = z.string().min(1).max(MAX_KEY_CHARS)

const fileSchema = z.object({
  version: z.literal(1),
  drafts: z.array(z.object({ key: draftKeySchema, draft: draftRecordSchema, updatedAt: z.number() })),
})

export interface DraftEntry {
  key: string
  draft: ComposerDraftRecord
  updatedAt: number
}

export interface DraftStoreDeps {
  file: string
  logger?: Logger
  now?: () => number
}

export interface DraftStore {
  load(): Promise<DraftEntry[]>
  /** `null` (or an empty draft) forgets the key. */
  save(key: string, draft: ComposerDraftRecord | null): Promise<void>
  /** Wait for the pending write (shutdown, tests). */
  flush(): Promise<void>
}

const isEmpty = (d: ComposerDraftRecord): boolean =>
  !d.text.trim() && d.mentions.length === 0 && d.attachments.length === 0

/** Newest first, capped in count and serialized size (attachments of the oldest drafts go first). */
export function boundDrafts(entries: DraftEntry[], maxBytes = MAX_FILE_BYTES): DraftEntry[] {
  let list = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS)
  const size = () => JSON.stringify({ version: 1, drafts: list }).length
  for (let i = list.length - 1; i >= 0 && size() > maxBytes; i--) {
    const entry = list[i] as DraftEntry
    if (entry.draft.attachments.length > 0) list[i] = { ...entry, draft: { ...entry.draft, attachments: [] } }
  }
  while (list.length > 0 && size() > maxBytes) list = list.slice(0, -1)
  return list
}

export function createDraftStore(deps: DraftStoreDeps): DraftStore {
  const now = deps.now ?? Date.now
  let entries: Map<string, DraftEntry> | undefined
  let writing: Promise<void> = Promise.resolve()
  let dirty = false

  async function ensureLoaded(): Promise<Map<string, DraftEntry>> {
    if (entries) return entries
    const map = new Map<string, DraftEntry>()
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(deps.file, 'utf8')))
      if (parsed.success) for (const entry of parsed.data.drafts) map.set(entry.key, entry)
      else deps.logger?.warn('draft file has an unexpected shape; starting empty')
    } catch (e) {
      // A missing file is the first run; anything else is logged and the drafts start empty.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') deps.logger?.warn('draft file unreadable', { error: e })
    }
    entries ??= map
    return entries
  }

  async function writeNow(): Promise<void> {
    dirty = false
    const list = boundDrafts([...(entries?.values() ?? [])])
    entries = new Map(list.map((e) => [e.key, e]))
    const tmp = `${deps.file}.${process.pid}.tmp`
    await mkdir(dirname(deps.file), { recursive: true })
    await writeFile(tmp, JSON.stringify({ version: 1, drafts: list }), 'utf8')
    await rename(tmp, deps.file)
  }

  function scheduleWrite(): Promise<void> {
    if (dirty) return writing
    dirty = true
    writing = writing.then(writeNow).catch((e: unknown) => deps.logger?.warn('saving drafts failed', { error: e }))
    return writing
  }

  return {
    async load() {
      return [...(await ensureLoaded()).values()].sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async save(key, draft) {
      const map = await ensureLoaded()
      if (!draft || isEmpty(draft)) {
        if (!map.delete(key)) return
      } else map.set(key, { key, draft, updatedAt: now() })
      await scheduleWrite()
    },
    flush: () => writing,
  }
}
