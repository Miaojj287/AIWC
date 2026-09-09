/**
 * Skill tools: `skill_view` reads a skill body; `skill_manage` lets the desktop agent create /
 * patch / delete skills under the first agent- or user-writable directory.
 */
import { promises as fsp } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { defineTool, type ToolDefinition, type ToolProfile, type ToolResult } from '@aiwc/protocol'
import { parseSkillFile, SKILL_BODY_MAX_CHARS, SKILL_FILE, type SkillIndexExt } from './skillIndex'

export const SKILL_NAME_RE = /^[a-z0-9-]{2,40}$/

/** Every profile that may run tools at all; persona threads have no tools by design. */
const ALL_TOOL_PROFILES: readonly ToolProfile[] = ['desktop-chat', 'wechat-bot', 'cron', 'subagent']

const SkillViewInput = z.object({
  name: z.string().min(1).describe('技能名称（见 <skills_index>）'),
})

const SkillManageInput = z.object({
  action: z.enum(['create', 'patch', 'delete']).describe('create=新建；patch=修改；delete=删除'),
  name: z.string().min(1).describe('技能名称，只允许小写字母、数字和连字符（2–40 字符）'),
  content: z.string().optional().describe('create / patch 时的完整 SKILL.md 内容（含 --- frontmatter ---）'),
  find: z.string().optional().describe('patch 时要替换的原文（与 replace 搭配；不提供 content 时使用）'),
  replace: z.string().optional().describe('patch 时的替换文本'),
})
type SkillManageInputT = z.infer<typeof SkillManageInput>

const err = (message: string): ToolResult => ({ content: message, isError: true })

export function skillTools(index: SkillIndexExt): ToolDefinition<any, any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const skillView = defineTool<z.infer<typeof SkillViewInput>>({
    name: 'skill_view',
    description: '读取一个技能（SKILL.md）的完整说明。先在 <skills_index> 里找到名称，需要按技能行事时再调用。',
    inputSchema: SkillViewInput,
    profiles: ALL_TOOL_PROFILES,
    risk: 'read',
    parallelSafe: true,
    summarize: (i) => `查看技能 ${i.name}`,
    async execute(input) {
      if (!index.get(input.name)) return err(`未找到技能：${input.name}`)
      try {
        return { content: await index.read(input.name) }
      } catch (e) {
        return err(`读取技能失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })

  const skillManage = defineTool<SkillManageInputT>({
    name: 'skill_manage',
    description: '新建、修改或删除用户技能（SKILL.md）。内容必须以 YAML frontmatter 开头并包含 name 与 description；只能操作用户或 Agent 创建的技能。',
    inputSchema: SkillManageInput,
    profiles: ['desktop-chat'],
    risk: 'write',
    parallelSafe: false,
    summarize: (i) => `${i.action === 'create' ? '新建' : i.action === 'patch' ? '修改' : '删除'}技能 ${i.name}`,
    async execute(input) {
      const target = index.writableDir()
      if (!target) return err('没有可写的技能目录')
      if (!SKILL_NAME_RE.test(input.name)) return err('技能名称无效：只允许小写字母、数字和连字符，长度 2–40')

      const root = resolve(target.path)
      const dir = resolve(root, input.name)
      if (!dir.startsWith(root + sep)) return err('技能名称非法')
      const file = join(dir, SKILL_FILE)
      const existing = index.get(input.name)
      if (existing && existing.source === 'builtin') return err(`内置技能不可修改：${input.name}`)
      if (existing && resolve(existing.dir) !== dir) return err(`技能 ${input.name} 位于其他目录，无法操作`)

      switch (input.action) {
        case 'create': {
          if (existing) return err(`技能已存在：${input.name}`)
          if (!input.content) return err('create 需要提供 content')
          const checked = validateContent(input.content, input.name)
          if (checked.error !== undefined) return err(checked.error)
          await fsp.mkdir(dir, { recursive: true })
          await fsp.writeFile(file, stampCreatedBy(checked.content), 'utf8')
          await index.refresh()
          return { content: `已创建技能 ${input.name}（${file}）` }
        }
        case 'patch': {
          if (!existing) return err(`未找到技能：${input.name}`)
          let next: string
          if (input.content !== undefined) {
            next = input.content
          } else if (input.find !== undefined && input.replace !== undefined) {
            const current = await fsp.readFile(file, 'utf8')
            if (!current.includes(input.find)) return err('patch 失败：未找到要替换的原文')
            next = current.replace(input.find, input.replace)
          } else {
            return err('patch 需要提供 content，或 find 与 replace')
          }
          const checked = validateContent(next, input.name)
          if (checked.error !== undefined) return err(checked.error)
          await fsp.writeFile(file, checked.content, 'utf8')
          await index.refresh()
          return { content: `已更新技能 ${input.name}` }
        }
        case 'delete': {
          if (!existing) return err(`未找到技能：${input.name}`)
          await fsp.rm(dir, { recursive: true, force: true })
          await index.refresh()
          return { content: `已删除技能 ${input.name}` }
        }
      }
    },
  })

  return [skillView, skillManage]
}

function validateContent(content: string, name: string): { content: string; error?: undefined } | { content?: undefined; error: string } {
  if (content.length > SKILL_BODY_MAX_CHARS) return { error: `技能内容过长：${content.length} 字符，上限 ${SKILL_BODY_MAX_CHARS}` }
  const { frontmatter, body } = parseSkillFile(content)
  if (!frontmatter) return { error: '缺少 YAML frontmatter（需以 --- 开头并包含 name 与 description）' }
  if (!frontmatter.name?.trim()) return { error: 'frontmatter 缺少 name' }
  if (frontmatter.name.trim() !== name) return { error: `frontmatter 的 name（${frontmatter.name}）与技能名称（${name}）不一致` }
  if (!frontmatter.description?.trim()) return { error: 'frontmatter 缺少 description' }
  if (!body.trim()) return { error: '技能正文为空' }
  return { content }
}

/** Add `created_by: agent` to the frontmatter block when it is not already present. */
export function stampCreatedBy(content: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!m || /^created_by:/m.test(m[1] ?? '')) return content
  const block = `---\n${m[1]}\ncreated_by: agent\n---`
  return block + content.slice(m[0].length)
}
