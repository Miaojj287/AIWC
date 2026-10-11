import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, promises as fsp, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asCallId, asThreadId, asTurnId, newStepId, type ToolContext } from '@aiwc/protocol'
import { createSkillIndex, SKILL_BODY_MAX_CHARS, SkillOpError } from './skillIndex'
import { skillTools } from './skillTools'

let root: string
let builtin: string
let user: string

const ctx = (): ToolContext => ({
  threadId: asThreadId('thr_1'),
  turnId: asTurnId('trn_1'),
  stepId: newStepId(),
  callId: asCallId('cal_1'),
  channel: 'desktop',
  profile: 'desktop-chat',
  signal: new AbortController().signal,
  services: {},
  progress: () => {},
  depth: 0,
})

function writeSkill(dir: string, folder: string, content: string): void {
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, folder, 'SKILL.md'), content, 'utf8')
}

const skillMd = (name: string, description: string, extra = '', body = '做点什么。') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-skill-entries-'))
  builtin = join(root, 'builtin')
  user = join(root, 'user')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const makeIndex = (disabled: string[] = [], onRefresh?: () => void) =>
  createSkillIndex({
    dirs: [
      { path: builtin, source: 'builtin' },
      { path: user, source: 'user' },
    ],
    disabled: () => disabled,
    onRefresh,
  })

describe('skill index entries (设置 › 技能)', () => {
  it('lists broken skills with diagnostics and keeps them away from the model', async () => {
    writeSkill(builtin, 'weekly', skillMd('weekly', '周报', 'command: /周报\n'))
    writeSkill(user, 'weekly', skillMd('weekly', '影子'))
    writeSkill(user, 'no-fm', '# 没有 frontmatter')
    writeSkill(user, 'bad-yaml', '---\nname: [unclosed\n---\n正文')
    writeSkill(user, 'no-desc', '---\nname: no-desc\n---\n正文')
    writeSkill(user, 'empty', skillMd('empty', '空', '', ''))
    writeSkill(user, 'big', skillMd('big', '大', '', 'x'.repeat(SKILL_BODY_MAX_CHARS + 10)))
    writeSkill(user, 'renamed', skillMd('other-name', '改名'))
    const index = makeIndex()
    await index.refresh()

    const byId = Object.fromEntries(index.entries().map((e) => [e.id, e]))
    expect(byId['builtin:weekly']).toMatchObject({ usable: true, diagnostics: [], deletable: false, command: '/周报' })
    expect(byId['user:weekly']).toMatchObject({ usable: false, diagnostics: ['duplicate_name'], deletable: true })
    expect(byId['user:no-fm']).toMatchObject({ usable: false, diagnostics: ['missing_frontmatter'] })
    expect(byId['user:bad-yaml']).toMatchObject({ usable: false, diagnostics: ['invalid_frontmatter'] })
    expect(byId['user:no-desc']).toMatchObject({ usable: true, diagnostics: ['missing_description'] })
    expect(byId['user:empty']).toMatchObject({ usable: false, diagnostics: ['empty_body'] })
    expect(byId['user:big']).toMatchObject({ usable: true, diagnostics: ['too_large'] })
    expect(byId['user:renamed']).toMatchObject({ name: 'other-name', usable: true, diagnostics: ['name_mismatch'] })

    const offered = index.list().map((s) => s.name)
    expect(offered).toEqual(['big', 'no-desc', 'other-name', 'weekly'])
    expect(index.indexFragment().render()).not.toContain('no-fm')
  })

  it('disabled skills stay listed but are not offered, and skill_view refuses them', async () => {
    writeSkill(user, 'daily', skillMd('daily', '日报'))
    writeSkill(user, 'weekly', skillMd('weekly', '周报'))
    const disabled = ['daily']
    const index = makeIndex(disabled)
    await index.refresh()
    expect(index.entries().find((e) => e.name === 'daily')).toMatchObject({ enabled: false, usable: true })
    expect(index.list().map((s) => s.name)).toEqual(['weekly'])
    const [view] = skillTools(index)
    expect(await view!.execute({ name: 'daily' }, ctx())).toMatchObject({ isError: true })
    expect(await view!.execute({ name: 'weekly' }, ctx())).toEqual({ content: '做点什么。' })
    // read live: switching back on applies without a rescan
    disabled.length = 0
    expect(index.list().map((s) => s.name)).toEqual(['daily', 'weekly'])
  })

  it('marks agent-created skills, reads params, returns the detail body and deletes only writable folders', async () => {
    writeSkill(builtin, 'weekly', skillMd('weekly', '周报'))
    writeSkill(
      user,
      'recap',
      skillMd(
        'recap',
        '复盘',
        'created_by: agent\narguments:\n  - name: chat\n    description: 要复盘的群\n    required: true\n  - days\n',
        '# 复盘\n\n步骤',
      ),
    )
    const onRefresh = vi.fn()
    const index = makeIndex([], onRefresh)
    await index.refresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    const recap = index.entries().find((e) => e.name === 'recap')!
    expect(recap).toMatchObject({ source: 'agent', id: 'user:recap' })
    expect(recap.params).toEqual([
      { name: 'chat', description: '要复盘的群', required: true },
      { name: 'days', required: false },
    ])
    expect(index.get('recap')?.params).toHaveLength(2)

    const detail = await index.detail('user:recap')
    expect(detail).toMatchObject({ body: '# 复盘\n\n步骤', truncated: false })
    expect(detail.path).toBe(join(user, 'recap', 'SKILL.md'))

    await expect(index.remove('builtin:weekly')).rejects.toBeInstanceOf(SkillOpError)
    await expect(index.detail('user:nope')).rejects.toMatchObject({ code: 'not_found' })
    await index.remove('user:recap')
    await expect(fsp.access(join(user, 'recap'))).rejects.toThrow()
    expect(index.get('recap')).toBeUndefined()
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })
})
