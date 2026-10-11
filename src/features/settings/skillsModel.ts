/**
 * 设置 › 技能, pure: labels for sources and diagnostics, the list filter, a row's status, and the 设为定时任务
 * payload (a new task tab pre-filled with `/skill name=…`).
 */
import type { SkillDiagnosticCode, SkillEntry, SkillSource } from '@aiwc/protocol'
import type { CommandMap } from '@/app/commands'
import type { MessageKey } from '@/i18n'
import { skillPromptTemplate } from '@/platform/skills'

export type SkillFilter = 'all' | SkillSource

export const SKILL_FILTERS: readonly SkillFilter[] = ['all', 'builtin', 'user', 'agent']

export const FILTER_LABEL: Record<SkillFilter, MessageKey> = {
  all: 'settings.skills.filter.all',
  builtin: 'settings.skills.filter.builtin',
  user: 'settings.skills.filter.user',
  agent: 'settings.skills.filter.agent',
}

export const SOURCE_LABEL: Record<SkillSource, MessageKey> = {
  builtin: 'settings.skills.source.builtin',
  user: 'settings.skills.source.user',
  agent: 'settings.skills.source.agent',
}

export const DIAGNOSTIC_LABEL: Record<SkillDiagnosticCode, MessageKey> = {
  missing_frontmatter: 'settings.skills.diagnostics.missingFrontmatter',
  invalid_frontmatter: 'settings.skills.diagnostics.invalidFrontmatter',
  missing_name: 'settings.skills.diagnostics.missingName',
  name_mismatch: 'settings.skills.diagnostics.nameMismatch',
  missing_description: 'settings.skills.diagnostics.missingDescription',
  empty_body: 'settings.skills.diagnostics.emptyBody',
  too_large: 'settings.skills.diagnostics.tooLarge',
  duplicate_name: 'settings.skills.diagnostics.duplicateName',
  read_failed: 'settings.skills.diagnostics.readFailed',
}

/** broken = cannot load at all; warning = loads, but something in SKILL.md needs a look. */
export type SkillStatus = 'broken' | 'disabled' | 'warning' | 'ok'

export function skillStatus(skill: SkillEntry): SkillStatus {
  if (!skill.usable) return 'broken'
  if (!skill.enabled) return 'disabled'
  return skill.diagnostics.length ? 'warning' : 'ok'
}

/** Skills shown for a source filter and a search query (name, command, description, tags). */
export function filterSkills(entries: readonly SkillEntry[], filter: SkillFilter, query: string): SkillEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((s) => {
    if (filter !== 'all' && s.source !== filter) return false
    if (!q) return true
    return [s.name, s.command, s.description, ...s.tags].some((field) => field.toLowerCase().includes(q))
  })
}

/** 设为定时任务: a new task named after the skill whose prompt invokes it with one slot per parameter. */
export function scheduleSkillPayload(skill: SkillEntry): CommandMap['tab.openTask'] {
  return { id: 'new', title: skill.name, name: skill.name, prompt: skillPromptTemplate(skill) }
}
