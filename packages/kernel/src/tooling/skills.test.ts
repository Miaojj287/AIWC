import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, promises as fsp, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asCallId, asThreadId, asTurnId, estimateTokens, newStepId, type Event, type ToolContext } from '@aiwc/protocol'
import { createSkillIndex, parseSkillFile, truncateDescription, SKILLS_INDEX_TOKEN_CAP } from './skillIndex'
import { skillTools, stampCreatedBy } from './skillTools'
import { planTools } from './planTools'

let root: string
const ctx = (services: Record<string, unknown> = {}): ToolContext => ({
  threadId: asThreadId('thr_1'),
  turnId: asTurnId('trn_1'),
  stepId: newStepId(),
  callId: asCallId('cal_1'),
  channel: 'desktop',
  profile: 'desktop-chat',
  signal: new AbortController().signal,
  services,
  progress: () => {},
  depth: 0,
})

function writeSkill(dir: string, folder: string, content: string): void {
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, folder, 'SKILL.md'), content, 'utf8')
}

const skillMd = (name: string, description: string, extra = '', body = '# 步骤\n\n做点什么。') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-skills-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('parseSkillFile', () => {
  it('parses frontmatter fields and body', () => {
    const { frontmatter, body } = parseSkillFile(skillMd('weekly', '生成周报', 'command: /周报\ntags: [report, weekly]\n'))
    expect(frontmatter).toMatchObject({ name: 'weekly', description: '生成周报', command: '/周报', tags: ['report', 'weekly'] })
    expect(body.trim()).toBe('# 步骤\n\n做点什么。')
  })
  it('no frontmatter → undefined; invalid yaml → undefined', () => {
    expect(parseSkillFile('# just body').frontmatter).toBeUndefined()
    expect(parseSkillFile('---\nname: [unclosed\n---\nbody').frontmatter).toBeUndefined()
  })
  it('truncateDescription caps at 60 chars', () => {
    const long = '很'.repeat(80)
    expect([...truncateDescription(long)]).toHaveLength(60)
    expect(truncateDescription('  a   b  ')).toBe('a b')
  })
})

describe('createSkillIndex', () => {
  it('scans dirs, first dir wins on duplicates, falls back to folder name, fragment is bounded', async () => {
    const builtin = join(root, 'builtin')
    const user = join(root, 'user')
    writeSkill(builtin, 'weekly', skillMd('weekly', '生成周报', 'command: /周报\n'))
    writeSkill(builtin, 'no-fm', '# 没有 frontmatter')
    writeSkill(user, 'weekly', skillMd('weekly', '用户覆盖版'))
    writeSkill(user, 'long', skillMd('long', 'x'.repeat(200)))
    for (let i = 0; i < 80; i++) writeSkill(user, `zz-filler-${i}`, skillMd(`zz-filler-${i}`, '填充技能描述'.repeat(5)))
    mkdirSync(join(user, 'not-a-skill'))
    writeFileSync(join(user, 'stray.md'), 'x')

    const index = createSkillIndex({ dirs: [{ path: builtin, source: 'builtin' }, { path: user, source: 'user' }, { path: join(root, 'missing'), source: 'agent' }] })
    expect(index.list()).toEqual([])
    await index.refresh()
    expect(index.get('weekly')).toMatchObject({ source: 'builtin', command: '/周报', description: '生成周报' })
    expect(index.get('no-fm')).toMatchObject({ name: 'no-fm', description: '' })
    expect([...index.get('long')!.description]).toHaveLength(60)
    expect(index.list()).toHaveLength(83)
    expect(index.writableDir()?.path).toBe(user)

    const frag = index.indexFragment()
    expect(frag).toMatchObject({ kind: 'skills_index', marker: '<skills_index>', tokenCap: SKILLS_INDEX_TOKEN_CAP })
    const text = frag.render()
    expect(text.startsWith('<skills_index>\n')).toBe(true)
    expect(text).toContain('- weekly: 生成周报 (/周报)')
    expect(estimateTokens(text)).toBeLessThanOrEqual(SKILLS_INDEX_TOKEN_CAP)
    expect(text).toMatch(/\[…已截断 \d+ 字\]$/)

    expect(await index.read('weekly')).toBe('# 步骤\n\n做点什么。')
    await expect(index.read('nope')).rejects.toThrow(/not found/)
  })

  it('read caps body at 20k chars', async () => {
    const dir = join(root, 'u')
    writeSkill(dir, 'big', skillMd('big', 'd', '', 'x'.repeat(25_000)))
    const index = createSkillIndex({ dirs: [{ path: dir, source: 'user' }] })
    await index.refresh()
    const body = await index.read('big')
    expect(body.length).toBeLessThan(20_100)
    expect(body).toContain('已截断')
  })
})

describe('skillTools', () => {
  it('skill_view reads or errors; profiles/risk as specified', async () => {
    const dir = join(root, 'u')
    writeSkill(dir, 'weekly', skillMd('weekly', '周报'))
    const index = createSkillIndex({ dirs: [{ path: dir, source: 'user' }] })
    await index.refresh()
    const [view, manage] = skillTools(index)
    expect(view).toMatchObject({ name: 'skill_view', risk: 'read', parallelSafe: true })
    expect(view!.profiles).toContain('wechat-bot')
    expect(manage).toMatchObject({ name: 'skill_manage', risk: 'write', profiles: ['desktop-chat'] })
    expect(await view!.execute({ name: 'weekly' }, ctx())).toMatchObject({ content: '# 步骤\n\n做点什么。' })
    expect(await view!.execute({ name: 'zzz' }, ctx())).toMatchObject({ isError: true })
  })

  it('skill_manage validates and writes under the first writable dir', async () => {
    const builtin = join(root, 'builtin')
    const agent = join(root, 'agent')
    const user = join(root, 'user')
    mkdirSync(agent)
    writeSkill(builtin, 'core', skillMd('core', '内置'))
    const index = createSkillIndex({ dirs: [{ path: builtin, source: 'builtin' }, { path: agent, source: 'agent' }, { path: user, source: 'user' }] })
    await index.refresh()
    const manage = skillTools(index)[1]!
    const run = (input: Record<string, unknown>) => manage.execute(input, ctx())

    expect(await run({ action: 'create', name: 'Bad Name', content: skillMd('Bad Name', 'x') })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'a', content: skillMd('a', 'x') })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'ok-skill', content: '# 无 frontmatter' })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'ok-skill', content: skillMd('other', 'x') })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'ok-skill', content: '---\nname: ok-skill\n---\nbody' })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'ok-skill', content: skillMd('ok-skill', 'x', '', 'y'.repeat(30_000)) })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'ok-skill' })).toMatchObject({ isError: true })
    expect(await run({ action: 'create', name: 'core', content: skillMd('core', 'x') })).toMatchObject({ isError: true })
    expect(await run({ action: 'patch', name: 'core', content: skillMd('core', 'x') })).toMatchObject({ isError: true })
    expect(await run({ action: 'delete', name: 'core' })).toMatchObject({ isError: true })

    const created = await run({ action: 'create', name: 'ok-skill', content: skillMd('ok-skill', '新技能') })
    expect(created.isError).toBeUndefined()
    const written = await fsp.readFile(join(agent, 'ok-skill', 'SKILL.md'), 'utf8')
    expect(written).toMatch(/^---\nname: ok-skill\ndescription: 新技能\ncreated_by: agent\n---/)
    expect(index.get('ok-skill')).toMatchObject({ source: 'agent' })
    expect(await run({ action: 'create', name: 'ok-skill', content: skillMd('ok-skill', 'dup') })).toMatchObject({ isError: true })

    expect(await run({ action: 'patch', name: 'ok-skill', find: '做点什么', replace: '做别的' })).toMatchObject({ content: expect.stringContaining('已更新') })
    expect(await index.read('ok-skill')).toContain('做别的')
    expect(await run({ action: 'patch', name: 'ok-skill', find: '不存在', replace: 'x' })).toMatchObject({ isError: true })
    expect(await run({ action: 'patch', name: 'ok-skill' })).toMatchObject({ isError: true })
    expect(await run({ action: 'patch', name: 'ok-skill', content: skillMd('ok-skill', '改描述') })).toMatchObject({ content: expect.stringContaining('已更新') })
    expect(index.get('ok-skill')?.description).toBe('改描述')

    expect(await run({ action: 'delete', name: 'ok-skill' })).toMatchObject({ content: expect.stringContaining('已删除') })
    expect(index.get('ok-skill')).toBeUndefined()
    await expect(fsp.access(join(agent, 'ok-skill'))).rejects.toThrow()
    expect(await run({ action: 'delete', name: 'ok-skill' })).toMatchObject({ isError: true })
  })

  it('skill_manage without a writable dir errors; stampCreatedBy is idempotent', async () => {
    const index = createSkillIndex({ dirs: [{ path: join(root, 'b'), source: 'builtin' }] })
    const manage = skillTools(index)[1]!
    expect(await manage.execute({ action: 'create', name: 'x-y', content: skillMd('x-y', 'd') }, ctx())).toMatchObject({ isError: true })
    const once = stampCreatedBy(skillMd('x-y', 'd'))
    expect(stampCreatedBy(once)).toBe(once)
    expect(once.match(/created_by/g)).toHaveLength(1)
  })
})

describe('planTools', () => {
  it('update_plan validates steps and emits plan.updated via services.emit', async () => {
    const [tool] = planTools()
    expect(tool).toMatchObject({ name: 'update_plan', risk: 'read', profiles: ['desktop-chat', 'subagent'] })
    const emit = vi.fn<(e: Event) => void>()
    const steps = [{ title: '读取', status: 'done' }, { title: '总结', status: 'doing' }]
    const parsed = tool!.inputSchema.safeParse({ steps })
    expect(parsed.success).toBe(true)
    expect(tool!.inputSchema.safeParse({ steps: [] }).success).toBe(false)
    expect(tool!.inputSchema.safeParse({ steps: [{ title: 'x', status: 'nope' }] }).success).toBe(false)
    expect(await tool!.execute({ steps }, ctx({ emit }))).toEqual({ content: 'ok' })
    expect(emit).toHaveBeenCalledWith({ type: 'plan.updated', threadId: 'thr_1', steps })
    expect(await tool!.execute({ steps }, ctx())).toEqual({ content: 'ok' })
    expect(tool!.summarize?.({ steps: steps as never })).toBe('更新计划（2 步，1 已完成）')
  })
})
