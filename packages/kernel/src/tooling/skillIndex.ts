/**
 * Skill index: scans every `<dir>/<skill>/SKILL.md`, parses the YAML frontmatter and exposes a bounded
 * `<skills_index>` fragment plus bounded reads of a skill body.
 */
import { promises as fsp, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { createFragment, type ContextFragment } from '@aiwc/protocol'
import type { SkillIndex, SkillMeta } from '../ports'

export const SKILL_DESCRIPTION_MAX = 60
export const SKILL_BODY_MAX_CHARS = 20_000
export const SKILLS_INDEX_TOKEN_CAP = 1500
export const SKILL_FILE = 'SKILL.md'

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
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Split `---` frontmatter from the markdown body. frontmatter is undefined when absent or invalid YAML. */
export function parseSkillFile(content: string): ParsedSkillFile {
  const m = FRONTMATTER_RE.exec(content)
  if (!m) return { frontmatter: undefined, body: content }
  const body = content.slice(m[0].length)
  try {
    const data: unknown = parseYaml(m[1] ?? '')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { frontmatter: undefined, body }
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
    }
  } catch {
    return { frontmatter: undefined, body }
  }
}

export function truncateDescription(text: string, max = SKILL_DESCRIPTION_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const chars = [...oneLine]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : oneLine
}

export interface SkillIndexExt extends SkillIndex {
  readonly dirs: readonly SkillDir[]
  /** First directory an agent/user may write into, if any. */
  writableDir(): SkillDir | undefined
}

export function createSkillIndex(opts: { dirs: SkillDir[] }): SkillIndexExt {
  const dirs = opts.dirs
  let skills = new Map<string, SkillMeta>()

  const scanDir = async (dir: SkillDir, into: Map<string, SkillMeta>): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir.path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(dir.path, entry.name)
      let content: string
      try {
        content = await fsp.readFile(join(skillDir, SKILL_FILE), 'utf8')
      } catch {
        continue
      }
      const { frontmatter } = parseSkillFile(content)
      const name = frontmatter?.name?.trim() || entry.name
      if (into.has(name)) continue // first directory wins
      into.set(name, {
        name,
        description: truncateDescription(frontmatter?.description ?? ''),
        command: frontmatter?.command,
        source: dir.source,
        dir: skillDir,
        tags: frontmatter?.tags,
      })
    }
  }

  const index: SkillIndexExt = {
    dirs,
    writableDir: () => dirs.find((d) => d.source === 'agent' || d.source === 'user'),

    async refresh() {
      const next = new Map<string, SkillMeta>()
      for (const dir of dirs) await scanDir(dir, next)
      skills = next
    },

    list() {
      return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
    },

    get(name) {
      return skills.get(name)
    },

    async read(name) {
      const meta = skills.get(name)
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

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : String(v)
}
