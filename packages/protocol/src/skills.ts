/**
 * Skills (设置 › 技能 and `/技能`): the shape of a skill as the settings page sees it, the diagnostics a broken
 * SKILL.md gets, the parameters a skill declares, and the one slash-command parser shared by the kernel (which
 * loads a skill when a turn starts with `/name`) and the renderer (local commands such as `/compact`).
 */
import { z } from 'zod'

export const SKILL_SOURCES = ['builtin', 'user', 'agent'] as const
/** builtin = shipped with the app; user = written by the user; agent = created by the Agent (`skill_manage`). */
export type SkillSource = (typeof SKILL_SOURCES)[number]

/**
 * What can be wrong with a SKILL.md. The page lists the skill with a warning badge and the reason; a blocking
 * diagnostic (SKILL_BLOCKING_DIAGNOSTICS) also keeps it away from the model and the slash menu.
 */
export const SKILL_DIAGNOSTIC_CODES = [
  'missing_frontmatter',
  'invalid_frontmatter',
  'missing_name',
  'name_mismatch',
  'missing_description',
  'empty_body',
  'too_large',
  'duplicate_name',
  'read_failed',
] as const
export type SkillDiagnosticCode = (typeof SKILL_DIAGNOSTIC_CODES)[number]

/** Diagnostics that make a skill unusable (the rest are warnings: the skill still loads). */
export const SKILL_BLOCKING_DIAGNOSTICS: readonly SkillDiagnosticCode[] = [
  'missing_frontmatter',
  'invalid_frontmatter',
  'empty_body',
  'duplicate_name',
  'read_failed',
]

export const isBlockingSkillDiagnostic = (code: SkillDiagnosticCode): boolean =>
  SKILL_BLOCKING_DIAGNOSTICS.includes(code)

/** A parameter a skill declares in its frontmatter (`arguments` / `params` / `parameters`). */
export interface SkillParam {
  name: string
  description?: string
  required: boolean
  default?: string
}

/** Most parameters read from one frontmatter; the rest are ignored. */
export const SKILL_PARAMS_MAX = 12
const PARAM_TEXT_MAX = 200

const clipText = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined
  const s = (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').trim()
  return s ? s.slice(0, PARAM_TEXT_MAX) : undefined
}

function paramFrom(name: unknown, spec: unknown): SkillParam | undefined {
  const n = clipText(name)
  if (!n) return undefined
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const o = spec as Record<string, unknown>
    const description = clipText(o.description ?? o.desc ?? o.hint)
    const fallback = clipText(o.default)
    return {
      name: n,
      required: o.required === true,
      ...(description ? { description } : {}),
      ...(fallback ? { default: fallback } : {}),
    }
  }
  const description = clipText(spec)
  return { name: n, required: false, ...(description ? { description } : {}) }
}

/**
 * Parameters declared in a skill's frontmatter. Accepts the shapes people actually write: a list of names, a list
 * of `{ name, description, required, default }`, or a map `name: description | { … }`. Anything else → none.
 */
export function parseSkillParams(frontmatter: Record<string, unknown> | undefined): SkillParam[] {
  const raw = frontmatter?.arguments ?? frontmatter?.params ?? frontmatter?.parameters
  const out: SkillParam[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const p =
        item && typeof item === 'object' && !Array.isArray(item)
          ? paramFrom((item as Record<string, unknown>).name, item)
          : paramFrom(item, undefined)
      if (p) out.push(p)
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
      const p = paramFrom(name, spec)
      if (p) out.push(p)
    }
  }
  const seen = new Set<string>()
  return out.filter((p) => !seen.has(p.name) && seen.add(p.name)).slice(0, SKILL_PARAMS_MAX)
}

/** One skill as 设置 › 技能 lists it — broken and disabled ones included. */
export interface SkillEntry {
  /** Stable id of the skill folder (`<root>:<folder>`); a shadowed duplicate has its own. */
  id: string
  name: string
  /** Full one-line description (the model's index shortens it). */
  description: string
  /** Slash command, e.g. `/周报`; `/<name>` when the skill declares none. */
  command: string
  source: SkillSource
  /** Not switched off in 设置 › 技能. */
  enabled: boolean
  /** No blocking diagnostic: the model and the slash menu may offer it (when also enabled). */
  usable: boolean
  diagnostics: SkillDiagnosticCode[]
  params: SkillParam[]
  tags: string[]
  /** Size of SKILL.md in characters. */
  size: number
  /** Built-in skills cannot be deleted. */
  deletable: boolean
}

/** A skill opened in 设置 › 技能: the entry plus its markdown body and where it lives. */
export interface SkillDetail extends SkillEntry {
  body: string
  path: string
  /** The body was longer than the viewer shows. */
  truncated: boolean
}

const skillId = z.string().min(1).max(200)
export const SkillIdRequestSchema = z.strictObject({ id: skillId })
export const SkillSetEnabledRequestSchema = z.strictObject({ name: z.string().min(1).max(80), enabled: z.boolean() })
export type SkillIdRequest = z.infer<typeof SkillIdRequestSchema>
export type SkillSetEnabledRequest = z.infer<typeof SkillSetEnabledRequestSchema>

/** `/name rest of the line` — `command` without the slash; `args` the trimmed remainder (may be empty). */
export interface SlashCommand {
  command: string
  args: string
}

/**
 * A message that starts with `/` followed by a command word. The word stops at whitespace and may not contain
 * another `/` (so a path such as `/Users/me` is not a command).
 */
export function parseSlashCommand(text: string): SlashCommand | undefined {
  const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m?.[1]) return undefined
  return { command: m[1], args: (m[2] ?? '').trim() }
}

/** Whether `command` (without the slash) names this skill: its name or its declared slash command. */
export const skillMatchesCommand = (skill: { name: string; command?: string }, command: string): boolean =>
  skill.name === command || (skill.command !== undefined && skill.command.replace(/^\//, '') === command)
