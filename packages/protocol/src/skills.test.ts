import { describe, expect, it } from 'vitest'
import { parseSkillParams, parseSlashCommand, skillMatchesCommand, SKILL_PARAMS_MAX } from './skills'

describe('parseSlashCommand', () => {
  it('splits the command word from its arguments', () => {
    expect(parseSlashCommand('/compact 保留报价')).toEqual({ command: 'compact', args: '保留报价' })
    expect(parseSlashCommand('  /周报\n产品群\n两周 ')).toEqual({ command: '周报', args: '产品群\n两周' })
    expect(parseSlashCommand('/new')).toEqual({ command: 'new', args: '' })
  })
  it('rejects text that is not a command', () => {
    expect(parseSlashCommand('hello /x')).toBeUndefined()
    expect(parseSlashCommand('/')).toBeUndefined()
    expect(parseSlashCommand('/Users/me/file.md')).toBeUndefined()
  })
  it('matches a skill by name or declared command', () => {
    const skill = { name: 'weekly-report', command: '/周报' }
    expect(skillMatchesCommand(skill, '周报')).toBe(true)
    expect(skillMatchesCommand(skill, 'weekly-report')).toBe(true)
    expect(skillMatchesCommand(skill, 'weekly')).toBe(false)
  })
})

describe('parseSkillParams', () => {
  it('reads lists of names, lists of objects and maps', () => {
    expect(parseSkillParams({ arguments: ['chat', 'days'] })).toEqual([
      { name: 'chat', required: false },
      { name: 'days', required: false },
    ])
    expect(
      parseSkillParams({ params: [{ name: 'chat', description: '群名', required: true, default: '产品群' }] }),
    ).toEqual([{ name: 'chat', description: '群名', required: true, default: '产品群' }])
    expect(parseSkillParams({ parameters: { chat: '群名', days: { required: true, default: 7 } } })).toEqual([
      { name: 'chat', description: '群名', required: false },
      { name: 'days', required: true, default: '7' },
    ])
  })
  it('ignores junk, duplicates and anything past the cap', () => {
    expect(parseSkillParams(undefined)).toEqual([])
    expect(parseSkillParams({ arguments: 'chat' })).toEqual([])
    expect(parseSkillParams({ arguments: [null, '', { description: 'no name' }, 'a', 'a'] })).toEqual([
      { name: 'a', required: false },
    ])
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`)
    expect(parseSkillParams({ arguments: many })).toHaveLength(SKILL_PARAMS_MAX)
  })
})
