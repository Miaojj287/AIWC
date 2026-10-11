import { describe, expect, it } from 'vitest'
import {
  asTurnId,
  newItemId,
  newStepId,
  type ContextFragmentItem,
  type HistoryItem,
  type UserInput,
} from '@aiwc/protocol'
import type { SkillMeta } from '../ports'
import { COMPACTION_SYSTEM_PROMPT, compactionSystemPrompt } from './compaction'
import { createMockModelClient } from './model/mock'
import { skillInvocationFragment, findInvokedSkill } from './skillInvocation'
import { createFakeSkillIndex } from './testing/fakes'
import { createThreadHarness, userInput } from './testing/harness'

const weekly: SkillMeta = {
  name: 'weekly-report',
  description: '周报',
  command: '/周报',
  source: 'builtin',
  dir: '/skills/weekly-report',
  params: [{ name: 'chat', description: '哪个群', required: true }],
}
const text = (t: string): UserInput => ({ content: [{ type: 'text', text: t }], mentions: [] })

describe('/技能 invocation', () => {
  it('matches the skill name or its declared command; unknown commands and paths are plain text', () => {
    const skills = createFakeSkillIndex([weekly])
    expect(findInvokedSkill(skills, text('/周报 产品群 最近两周'))).toMatchObject({
      skill: { name: 'weekly-report' },
      command: '周报',
      args: '产品群 最近两周',
    })
    expect(findInvokedSkill(skills, text('/weekly-report'))).toMatchObject({ args: '' })
    expect(findInvokedSkill(skills, text('/nope 你好'))).toBeUndefined()
    expect(findInvokedSkill(skills, text('/Users/me/a.md 看看'))).toBeUndefined()
    expect(findInvokedSkill(skills, text('请用 /周报'))).toBeUndefined()
    // only the first text part counts (a scheduled task puts its prompt first and the run rules after it)
    const task: UserInput = {
      content: [
        { type: 'text', text: '/周报 产品群' },
        { type: 'text', text: '【定时任务】规则…' },
      ],
      mentions: [],
    }
    expect(findInvokedSkill(skills, task)).toMatchObject({ args: '产品群' })
  })

  it('renders the skill body, the arguments and the declared params; refuses non-owner channels', async () => {
    const skills = createFakeSkillIndex([weekly])
    const fragment = await skillInvocationFragment(skills, text('/周报 产品群'), 'desktop')
    const rendered = fragment!.render()
    expect(fragment!.kind).toBe('skill_invocation')
    expect(rendered.startsWith('<skill_invocation>')).toBe(true)
    expect(rendered).toContain('参数：产品群')
    expect(rendered).toContain('- chat（必填）：哪个群')
    expect(rendered).toContain('# weekly-report')
    expect(await skillInvocationFragment(skills, text('/周报'), 'cron')).toBeDefined()
    expect(await skillInvocationFragment(skills, text('/周报'), 'wechat-ilink')).toBeUndefined()
    expect(await skillInvocationFragment(skills, text('/周报'), 'wechat-ui')).toBeUndefined()
  })

  it('the turn loop records the skill fragment for a /skill turn, and not for ordinary text', async () => {
    const model = createMockModelClient({ steps: [{ text: '好的。' }], loopLast: true })
    const h = await createThreadHarness({ model })
    h.services.skills = createFakeSkillIndex([weekly])
    await (
      await h.thread.startTurn(userInput('/周报 产品群'), 'start')
    ).promise
    const fragments = (): ContextFragmentItem[] =>
      h.services.rollout
        .itemsOf(h.thread.id)
        .filter((i): i is ContextFragmentItem => i.type === 'context_fragment' && i.kind === 'skill_invocation')
    expect(fragments()).toHaveLength(1)
    expect(fragments()[0]!.text).toContain('# weekly-report')

    await (
      await h.thread.startTurn(userInput('/unknown 你好'), 'start')
    ).promise
    expect(fragments()).toHaveLength(1)
  })
})

describe('/compact instructions', () => {
  it('appends a bounded focus note to the compaction prompt', () => {
    expect(compactionSystemPrompt()).toBe(COMPACTION_SYSTEM_PROMPT)
    expect(compactionSystemPrompt('   ')).toBe(COMPACTION_SYSTEM_PROMPT)
    const withNote = compactionSystemPrompt('保留所有报价数字')
    expect(withNote.startsWith(COMPACTION_SYSTEM_PROMPT)).toBe(true)
    expect(withNote).toContain('保留所有报价数字')
    expect(compactionSystemPrompt('x'.repeat(5000)).length).toBeLessThan(COMPACTION_SYSTEM_PROMPT.length + 1100)
  })

  it('thread.compact passes the instructions to the summariser', async () => {
    const model = createMockModelClient({ steps: [{ text: '。' }], ref: { contextWindow: 600 }, loopLast: true })
    const aux = createMockModelClient({ steps: [{ text: '摘要。' }], loopLast: true })
    const h = await createThreadHarness({ model, auxiliary: aux })
    const items: HistoryItem[] = []
    for (let i = 0; i < 4; i++) {
      const turnId = asTurnId(`trn_${i}`)
      const long = `第${i}轮：这是一段较长的对话内容，包含报价 ${i}00 元。`.repeat(6)
      items.push(
        {
          type: 'user_message',
          id: newItemId(),
          turnId,
          createdAt: i,
          content: [{ type: 'text', text: long }],
          mentions: [],
        },
        { type: 'assistant_message', id: newItemId(), turnId, stepId: newStepId(), createdAt: i, text: long },
      )
    }
    h.thread.context.recordItems(items)
    await h.thread.submit({ type: 'thread.compact', threadId: h.thread.id, instructions: '保留所有报价' })
    expect(aux.requests[0]!.system).toContain('保留所有报价')
  })
})
