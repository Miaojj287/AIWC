/**
 * Skill index: scans every `<dir>/<skill>/SKILL.md`, parses the YAML frontmatter and exposes a bounded
 * `<skills_index>` fragment plus bounded reads of a skill body. A SKILL.md that is broken (no or invalid
 * frontmatter, empty body, shadowed by an earlier folder of the same name) stays listed for 设置 › 技能 with
 * its diagnostics but is never offered to the model; neither is a skill the user switched off.
 */
import { promises as fsp, type Dirent } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  createFragment,
  isBlockingSkillDiagnostic,
  parseSkillParams,
  type ContextFragment,
  type SkillDetail,
  type SkillDiagnosticCode,
  type SkillEntry,
} from '@aiwc/protocol'
import type { SkillIndex, SkillMeta } from '../ports'

export const SKILL_DESCRIPTION_MAX = 60
export const SKILL_BODY_MAX_CHARS = 20_000
export const SKILLS_INDEX_TOKEN_CAP = 1500
export const SKILL_FILE = 'SKILL.md'
/** Longest description kept for the settings list (the model's index uses SKILL_DESCRIPTION_MAX). */
const ENTRY_DESCRIPTION_MAX = 300
/** Longest body the settings viewer receives. */
const DETAIL_BODY_MAX_CHARS = 60_000

export type SkillSource = SkillMeta['source']

export interface SkillDir {
  path: string
  source: SkillSource
}

export interface SkillFrontmatter {
  name?: string
  description?: string
  command?: string
  tags?: string[]
  [key: string]: unknown
}

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter | undefined
  body: string
  /** ok = parsed; missing = no `---` block; invalid = the block is not a YAML mapping. */
  status: 'ok' | 'missing' | 'invalid'
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Split `---` frontmatter from the markdown body. frontmatter is undefined when absent or invalid YAML. */
export function parseSkillFile(content: string): ParsedSkillFile {
  const m = FRONTMATTER_RE.exec(content)
  if (!m) return { frontmatter: undefined, body: content, status: 'missing' }
  const body = content.slice(m[0].length)
  try {
    const data: unknown = parseYaml(m[1] ?? '')
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return { frontmatter: undefined, body, status: 'invalid' }
    const fm = data as Record<string, unknown>
    return {
      frontmatter: {
        ...fm,
        name: asString(fm.name),
        description: asString(fm.description),
        command: asString(fm.command),
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : undefined,
      },
      body,
      status: 'ok',
    }
  } catch {
    return { frontmatter: undefined, body, status: 'invalid' }
  }
}

export function truncateDescription(text: string, max = SKILL_DESCRIPTION_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const chars = [...oneLine]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : oneLine
}

/** Why a settings operation on a skill was refused (the host maps the code to UI copy). */
export class SkillOpError extends Error {
  constructor(readonly code: 'not_found' | 'builtin' | 'outside_root') {
    super(`skill operation refused: ${code}`)
    this.name = 'SkillOpError'
  }
}

export interface SkillIndexExt extends SkillIndex {
  readonly dirs: readonly SkillDir[]
  /** First directory an agent/user may write into, if any. */
  writableDir(): SkillDir | undefined
  /** Every skill folder found by the last refresh — disabled, broken and shadowed ones included. */
  entries(): SkillEntry[]
  /** One folder (by entry id) with its markdown body, for the settings viewer. */
  detail(id: string): Promise<SkillDetail>
  /** Delete a user- or Agent-created skill folder by entry id, then rescan. Built-in skills are refused. */
  remove(id: string): Promise<void>
}

export interface SkillIndexOptions {
  dirs: SkillDir[]
  /** Names switched off in 设置 › 技能 (read on every call, so a config change applies at once). */
  disabled?: () => readonly string[]
  /** After every refresh (the host pushes the new list to the settings page and the `/` menu). */
  onRefresh?: (entries: SkillEntry[]) => void
}

interface Indexed {
  meta: SkillMeta
  entry: Omit<SkillEntry, 'enabled'>
  root: SkillDir
  file: string
}

export function createSkillIndex(opts: SkillIndexOptions): SkillIndexExt {
  const dirs = opts.dirs
  const disabledNames = (): ReadonlySet<string> => new Set(opts.disabled?.() ?? [])
  let primary = new Map<string, Indexed>()
  let all: Indexed[] = []

  const scanDir = async (dir: SkillDir, into: Map<string, Indexed>, found: Indexed[]): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir.path, { withFileTypes: true })
    } catch {
      return // a missing skills folder simply has no skills
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(dir.path, entry.name)
      const file = join(skillDir, SKILL_FILE)
      let content: string | undefined
      let readFailed = false
      try {
        content = await fsp.readFile(file, 'utf8')
      } catch (err) {
        // A folder without SKILL.md is not a skill; one that exists but cannot be read is a broken skill.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        readFailed = true
      }
      const item = indexFolder(dir, entry.name, skillDir, file, content, readFailed)
      if (into.has(item.meta.name)) {
        item.entry.diagnostics.push('duplicate_name')
        item.entry.usable = false
      } else {
        into.set(item.meta.name, item)
      }
      found.push(item)
    }
  }

  const withEnabled = (item: Indexed, disabled: ReadonlySet<string>): SkillEntry => ({
    ...item.entry,
    diagnostics: [...item.entry.diagnostics],
    enabled: !disabled.has(item.meta.name),
  })

  const byId = (id: string): Indexed => {
    const item = all.find((i) => i.entry.id === id)
    if (!item) throw new SkillOpError('not_found')
    return item
  }

  const index: SkillIndexExt = {
    dirs,
    writableDir: () => dirs.find((d) => d.source === 'agent' || d.source === 'user'),

    async refresh() {
      const next = new Map<string, Indexed>()
      const found: Indexed[] = []
      for (const dir of dirs) await scanDir(dir, next, found)
      primary = next
      all = found
      opts.onRefresh?.(index.entries())
    },

    list() {
      const disabled = disabledNames()
      return [...primary.values()]
        .filter((i) => i.entry.usable && !disabled.has(i.meta.name))
        .map((i) => i.meta)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    get(name) {
      return primary.get(name)?.meta
    },

    entries() {
      const disabled = disabledNames()
      return all
        .map((i) => withEnabled(i, disabled))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    },

    async detail(id) {
      const item = byId(id)
      let body = ''
      try {
        body = parseSkillFile(await fsp.readFile(item.file, 'utf8')).body.trim()
      } catch {
        // the entry already carries read_failed; the viewer shows the diagnostics instead of a body
      }
      return {
        ...withEnabled(item, disabledNames()),
        body: body.slice(0, DETAIL_BODY_MAX_CHARS),
        truncated: body.length > DETAIL_BODY_MAX_CHARS,
        path: item.file,
      }
    },

    async remove(id) {
      const item = byId(id)
      if (item.root.source === 'builtin') throw new SkillOpError('builtin')
      const root = resolve(item.root.path)
      const target = resolve(item.meta.dir)
      if (!target.startsWith(root + sep)) throw new SkillOpError('outside_root')
      await fsp.rm(target, { recursive: true, force: true })
      await index.refresh()
    },

    async read(name) {
      const meta = primary.get(name)?.meta
      if (!meta) throw new Error(`skill not found: ${name}`)
      const content = await fsp.readFile(join(meta.dir, SKILL_FILE), 'utf8')
      const { body } = parseSkillFile(content)
      const trimmed = body.trim()
      if (trimmed.length <= SKILL_BODY_MAX_CHARS) return trimmed
      return `${trimmed.slice(0, SKILL_BODY_MAX_CHARS)}\n\n[技能正文已截断：共 ${trimmed.length} 字符]`
    },

    indexFragment(): ContextFragment {
      return createFragment('skills_index', '<skills_index>', SKILLS_INDEX_TOKEN_CAP, () => {
        const list = index.list()
        if (list.length === 0) return '(暂无技能)'
        return list
          .map((s) => `- ${s.name}: ${s.description || '(无描述)'}${s.command ? ` (${s.command})` : ''}`)
          .join('\n')
      })
    },
  }
  return index
}

/** Parse one skill folder into its index metadata and settings entry, collecting what is wrong with it. */
function indexFolder(
  root: SkillDir,
  folder: string,
  skillDir: string,
  file: string,
  content: string | undefined,
  readFailed: boolean,
): Indexed {
  const diagnostics: SkillDiagnosticCode[] = []
  const parsed = content === undefined ? undefined : parseSkillFile(content)
  const fm = parsed?.frontmatter
  if (readFailed) diagnostics.push('read_failed')
  else if (parsed?.status === 'missing') diagnostics.push('missing_frontmatter')
  else if (parsed?.status === 'invalid') diagnostics.push('invalid_frontmatter')
  const declaredName = fm?.name?.trim()
  if (fm && !declaredName) diagnostics.push('missing_name')
  if (declaredName && declaredName !== folder) diagnostics.push('name_mismatch')
  if (fm && !fm.description?.trim()) diagnostics.push('missing_description')
  if (parsed && !parsed.body.trim()) diagnostics.push('empty_body')
  if (content !== undefined && content.length > SKILL_BODY_MAX_CHARS) diagnostics.push('too_large')

  const name = declaredName || folder
  // skill_manage writes into the user folder and stamps `created_by: agent`.
  const source: SkillSource = root.source === 'user' && fm?.created_by === 'agent' ? 'agent' : root.source
  const params = parseSkillParams(fm)
  const meta: SkillMeta = {
    name,
    description: truncateDescription(fm?.description ?? ''),
    command: fm?.command,
    source,
    dir: skillDir,
    tags: fm?.tags,
    ...(params.length ? { params } : {}),
  }
  return {
    meta,
    root,
    file,
    entry: {
      id: `${root.source}:${folder}`,
      name,
      description: truncateDescription(fm?.description ?? '', ENTRY_DESCRIPTION_MAX),
      command: fm?.command?.trim() || `/${name}`,
      source,
      usable: !diagnostics.some(isBlockingSkillDiagnostic),
      diagnostics,
      params,
      tags: fm?.tags ?? [],
      size: content?.length ?? 0,
      deletable: root.source !== 'builtin',
    },
  }
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : String(v)
}
