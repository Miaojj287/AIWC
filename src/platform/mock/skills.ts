/**
 * skills:* — 设置 › 技能 in the web preview: a few demo skills (one Agent-created with parameters, one broken),
 * deletions kept in localStorage, the on/off switch stored in the mock config like the real host does.
 */
import type { SkillDetail, SkillEntry } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'

const DELETED_KEY = 'aiwc.mock.skills.deleted'

interface DemoSkill extends Omit<SkillEntry, 'enabled'> {
  body: string
}

const DEMO: readonly DemoSkill[] = [
  {
    id: 'builtin:weekly-report',
    name: 'weekly-report',
    description: '把一个群最近一周的讨论整理成周报草稿（议题 / 结论 / 待办 / 风险）',
    command: '/周报',
    source: 'builtin',
    usable: true,
    diagnostics: [],
    params: [],
    tags: ['report'],
    size: 820,
    deletable: false,
    body: '# 周报草稿\n\n1. 用 `get_timeline` 拉取最近 7 天的消息。\n2. 提炼议题、结论、待办与风险。\n3. 输出 Markdown。',
  },
  {
    id: 'user:group-recap',
    name: 'group-recap',
    description: '复盘一个群在指定天数里的讨论，列出谁提了什么、还有哪些没解决',
    command: '/group-recap',
    source: 'agent',
    usable: true,
    diagnostics: [],
    params: [
      { name: 'chat', description: '要复盘的群', required: true },
      { name: 'days', description: '往前看几天', required: false, default: '7' },
    ],
    tags: [],
    size: 640,
    deletable: true,
    body: '# 群聊复盘\n\n1. 找到 `chat` 对应的会话。\n2. 读取最近 `days` 天的消息。\n3. 按人归纳观点，列出未解决的问题。',
  },
  {
    id: 'user:draft-notes',
    name: 'draft-notes',
    description: '',
    command: '/draft-notes',
    source: 'user',
    usable: false,
    diagnostics: ['invalid_frontmatter'],
    params: [],
    tags: [],
    size: 120,
    deletable: true,
    body: '记一下：把会议纪要整理成要点。',
  },
]

export function skillsHandlers(ctx: MockContext): HandlersFor<'skills'> {
  const deleted = (): string[] => ctx.kv.get<string[]>(DELETED_KEY, [])
  const entries = (): SkillEntry[] => {
    const off = new Set(ctx.config().agent.disabledSkills)
    const gone = new Set(deleted())
    return DEMO.filter((s) => !gone.has(s.id)).map(({ body: _body, ...s }) => ({ ...s, enabled: !off.has(s.name) }))
  }
  const find = (id: string): DemoSkill => {
    const skill = DEMO.find((s) => s.id === id && !deleted().includes(id))
    if (!skill) throw new Error('skill not found')
    return skill
  }
  const changed = () => ctx.emit('skills:changed', { skills: entries() })

  return {
    'skills:list': () => entries(),
    'skills:get': ({ id }): SkillDetail => {
      const skill = find(id)
      const entry = entries().find((e) => e.id === id)!
      return { ...entry, body: skill.body, truncated: false, path: `~/AIWC/skills/${id.replace(':', '/')}/SKILL.md` }
    },
    'skills:setEnabled': ({ name, enabled }) => {
      const rest = ctx.config().agent.disabledSkills.filter((n) => n !== name)
      ctx.setConfig({ agent: { disabledSkills: enabled ? rest : [...rest, name] } })
      changed()
    },
    'skills:delete': ({ id }) => {
      const skill = find(id)
      if (!skill.deletable) throw new Error('built-in skills cannot be deleted')
      ctx.kv.set(DELETED_KEY, [...deleted(), id])
      changed()
    },
  }
}
