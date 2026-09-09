/**
 * createDiaryStore — `dir/YYYY-MM-DD.md`:
 *
 *   ---
 *   generatedAt: 1757…
 *   degraded: false
 *   sources: { sessions: [...], messageCount: 120, agentTurns: 3 }
 *   ---
 *   <diary markdown>
 *
 *   ## 记忆线索
 *   - cue
 *
 * `markdown` on the DiaryEntry excludes the cue section; put() strips a cue section the caller left in.
 */
import type { DiaryEntry } from '@aiwc/protocol'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { KeyedMutex, atomicWriteFile, ensureDir, listFiles, readTextIfExists, withFileLock } from '../internal/fsx'
import { DATE_RE, isValidDate } from '../internal/time'

export const CUES_HEADING = '## 记忆线索'
const CUES_HEADING_RE = /^##\s*记忆线索\s*$/m
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)、])\s+(.*\S)\s*$/

export interface DiaryStoreExt {
  readonly dir: string
  pathFor(date: string): string
  list(): Promise<Array<Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'>>>
  get(date: string): Promise<DiaryEntry | undefined>
  put(entry: DiaryEntry): Promise<void>
}

interface FrontMatter {
  generatedAt?: number
  degraded?: boolean
  sources?: { sessions?: unknown; messageCount?: unknown; agentTurns?: unknown }
}

function splitFrontMatter(raw: string): { meta: FrontMatter; body: string } {
  const text = raw.replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { meta: {}, body: text }
  const yamlText = text.slice(4, end)
  const after = text.slice(end + 4).replace(/^\n/, '')
  let meta: FrontMatter = {}
  try {
    const parsed: unknown = parseYaml(yamlText)
    if (parsed && typeof parsed === 'object') meta = parsed as FrontMatter
  } catch {
    meta = {}
  }
  return { meta, body: after }
}

/** Split `## 记忆线索` (last occurrence) off a markdown body. Returns the body without it and the parsed bullets. */
export function splitCues(markdown: string): { body: string; cues: string[] } {
  const text = markdown.replace(/\r\n/g, '\n')
  let idx = -1
  for (const m of text.matchAll(new RegExp(CUES_HEADING_RE.source, 'gm'))) idx = m.index ?? idx
  if (idx < 0) return { body: text.trim(), cues: [] }
  const body = text.slice(0, idx).trim()
  const cues: string[] = []
  for (const line of text.slice(idx).split('\n').slice(1)) {
    if (/^##?\s/.test(line)) break // next heading ends the section
    const m = line.match(BULLET_RE)
    if (m?.[1]) cues.push(m[1].trim())
  }
  return { body, cues }
}

export function renderDiaryFile(entry: DiaryEntry): string {
  const { body, cues: inline } = splitCues(entry.markdown)
  const cues = (entry.cues.length ? entry.cues : inline).map((c) => c.trim()).filter(Boolean)
  const meta = {
    generatedAt: entry.generatedAt,
    degraded: Boolean(entry.degraded),
    sources: {
      sessions: entry.sources.sessions,
      messageCount: entry.sources.messageCount,
      agentTurns: entry.sources.agentTurns,
    },
  }
  const fm = stringifyYaml(meta, { lineWidth: 0 }).trimEnd()
  const cueBlock = cues.length ? `\n\n${CUES_HEADING}\n${cues.map((c) => `- ${c}`).join('\n')}` : ''
  return `---\n${fm}\n---\n${body}${cueBlock}\n`
}

export function parseDiaryFile(date: string, raw: string): DiaryEntry {
  const { meta, body } = splitFrontMatter(raw)
  const { body: markdown, cues } = splitCues(body)
  const sessions = Array.isArray(meta.sources?.sessions) ? meta.sources.sessions.map(String) : []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const entry: DiaryEntry = {
    date,
    markdown,
    cues,
    sources: { sessions, messageCount: num(meta.sources?.messageCount), agentTurns: num(meta.sources?.agentTurns) },
    generatedAt: num(meta.generatedAt),
  }
  if (meta.degraded) entry.degraded = true
  return entry
}

export function createDiaryStore(opts: { dir: string }): DiaryStoreExt {
  const dir = opts.dir
  ensureDir(dir)
  const mutex = new KeyedMutex()
  const pathFor = (date: string) => join(dir, `${date}.md`)
  const assertDate = (date: string) => {
    if (!isValidDate(date)) throw new Error(`日期格式应为 YYYY-MM-DD：${date}`)
  }

  return {
    dir,
    pathFor,

    async list() {
      const out: Array<Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'>> = []
      for (const name of listFiles(dir)) {
        const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
        if (!m?.[1] || !DATE_RE.test(m[1])) continue
        const raw = readTextIfExists(join(dir, name))
        if (raw === undefined) continue
        const { meta } = splitFrontMatter(raw)
        const row: Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'> = {
          date: m[1],
          generatedAt: typeof meta.generatedAt === 'number' ? meta.generatedAt : 0,
        }
        if (meta.degraded) row.degraded = true
        out.push(row)
      }
      return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    },

    async get(date) {
      if (!isValidDate(date)) return undefined
      const raw = readTextIfExists(pathFor(date))
      if (raw === undefined) return undefined
      return parseDiaryFile(date, raw)
    },

    async put(entry) {
      assertDate(entry.date)
      await mutex.run(entry.date, () => withFileLock(pathFor(entry.date), () => atomicWriteFile(pathFor(entry.date), renderDiaryFile(entry))))
    },
  }
}
