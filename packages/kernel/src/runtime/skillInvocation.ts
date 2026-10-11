/**
 * `/技能` — a user turn whose text starts with `/<skill>` (the skill's name or its declared command, e.g. `/周报`)
 * gets that skill's full SKILL.md injected as a turn fragment by the kernel itself, so the skill applies even when
 * the model would not have called `skill_view`. The rest of the line is the skill's arguments. Scheduled tasks go
 * through the same path (their prompt is the first text part of the run's input).
 *
 * Only the owner's own channels honour it: in a WeChat bot thread the text comes from other people, who must not
 * be able to load instructions into the Agent by typing a slash.
 */
import {
  createFragment,
  parseSlashCommand,
  skillMatchesCommand,
  type ChannelKind,
  type ContextFragment,
  type UserInput,
} from '@aiwc/protocol'
import type { SkillIndex, SkillMeta } from '../ports'
import type { Logger } from './types'

/** Channels whose user turns are the owner's own instruction. */
const OWNER_CHANNELS: readonly ChannelKind[] = ['desktop', 'cron', 'wechat-remote']
export const SKILL_INVOCATION_TOKEN_CAP = 9000
/** Longest argument text repeated inside the fragment (the user message carries the whole text anyway). */
const ARGS_MAX_CHARS = 2000

/** The skill a turn invokes, if its first text part starts with `/<skill>` and that skill is active. */
export function findInvokedSkill(
  skills: Pick<SkillIndex, 'list'>,
  input: UserInput,
): { skill: SkillMeta; command: string; args: string } | undefined {
  const first = input.content.find((p) => p.type === 'text')
  if (!first || first.type !== 'text') return undefined
  const slash = parseSlashCommand(first.text)
  if (!slash) return undefined
  const skill = skills.list().find((s) => skillMatchesCommand(s, slash.command))
  return skill ? { skill, command: slash.command, args: slash.args } : undefined
}

/** One line per declared parameter, so the model knows what the arguments are meant to fill. */
function renderParams(skill: SkillMeta): string {
  if (!skill.params?.length) return ''
  const lines = skill.params.map((p) => {
    const notes = [p.required ? '必填' : '可选', p.default ? `默认 ${p.default}` : ''].filter(Boolean).join('，')
    return `- ${p.name}（${notes}）${p.description ? `：${p.description}` : ''}`
  })
  return ['技能声明的参数（缺少必填参数且无法从上下文推断时，在答复里说明缺了什么）：', ...lines].join('\n')
}

/**
 * The fragment for a `/skill` turn, or undefined when the turn does not invoke an active skill (then the text is
 * an ordinary message — an unknown `/x` included).
 */
export async function skillInvocationFragment(
  skills: SkillIndex,
  input: UserInput,
  channel: ChannelKind,
  logger?: Logger,
): Promise<ContextFragment | undefined> {
  if (!OWNER_CHANNELS.includes(channel)) return undefined
  const invoked = findInvokedSkill(skills, input)
  if (!invoked) return undefined
  let body: string
  try {
    body = await skills.read(invoked.skill.name)
  } catch (err) {
    logger?.('warn', `skill ${invoked.skill.name} could not be loaded for /${invoked.command}`, err)
    return undefined
  }
  const { skill, command, args } = invoked
  const clippedArgs = args.length > ARGS_MAX_CHARS ? `${args.slice(0, ARGS_MAX_CHARS)}…` : args
  return createFragment('skill_invocation', '<skill_invocation>', SKILL_INVOCATION_TOKEN_CAP, () =>
    [
      `用户在本轮用 /${command} 调用了技能「${skill.name}」。按下面的技能说明完成本轮请求，不需要再用 skill_view 读取它。`,
      `参数：${clippedArgs || '（无）'}`,
      renderParams(skill),
      '--- 技能说明 ---',
      body,
    ]
      .filter(Boolean)
      .join('\n'),
  )
}
