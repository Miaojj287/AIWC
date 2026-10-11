import { describe, expect, it } from 'vitest'
import type { SkillEntry } from '@aiwc/protocol'
import { filterSkills, scheduleSkillPayload, skillStatus } from './skillsModel'

const base: SkillEntry = {
  id: 'builtin:weekly',
  name: 'weekly',
  description: '周报草稿',
  command: '/周报',
  source: 'builtin',
  enabled: true,
  usable: true,
  diagnostics: [],
  params: [],
  tags: ['report'],
  size: 10,
  deletable: false,
}

describe('skillsModel', () => {
  it('derives the row status: broken before disabled before warning', () => {
    expect(skillStatus(base)).toBe('ok')
    expect(skillStatus({ ...base, diagnostics: ['missing_description'] })).toBe('warning')
    expect(skillStatus({ ...base, enabled: false, diagnostics: ['missing_description'] })).toBe('disabled')
    expect(skillStatus({ ...base, enabled: false, usable: false })).toBe('broken')
  })
  it('filters by source and by name, command, description or tag', () => {
    const mine = {
      ...base,
      id: 'user:recap',
      name: 'recap',
      command: '/recap',
      description: '复盘',
      source: 'user' as const,
      tags: [],
    }
    expect(filterSkills([base, mine], 'user', '')).toEqual([mine])
    expect(filterSkills([base, mine], 'all', 'REPORT')).toEqual([base])
    expect(filterSkills([base, mine], 'all', '周报')).toEqual([base])
    expect(filterSkills([base, mine], 'builtin', 'recap')).toEqual([])
  })
  it('schedules a skill as a new task named after it', () => {
    expect(scheduleSkillPayload(base)).toEqual({ id: 'new', title: 'weekly', name: 'weekly', prompt: '/周报' })
  })
})
