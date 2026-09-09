/**
 * relationshipTools — get_relationship_profile over services.relationships (+ substrate for names).
 * Read-only. On the wechat-bot profile the bot may only read the profile of the chat it is bound to.
 */
import type { RelationshipStore, SubstrateService, ToolResult } from '@aiwc/protocol'
import { defineTool } from '@aiwc/protocol'
import { z } from 'zod'
import { recentSamples } from '../fragments/relationshipFragmentProvider'
import { truncateChars } from '../internal/text'
import type { AnyToolDefinition } from '../types'

export interface RelationshipToolServices {
  relationships: RelationshipStore
  substrate: SubstrateService
  [key: string]: unknown
}

const ok = (content: string): ToolResult => ({ content })
const fail = (content: string): ToolResult => ({ content, isError: true })

export function relationshipTools(): AnyToolDefinition<RelationshipToolServices>[] {
  const get = defineTool<{ contactId: string }, RelationshipToolServices>({
    name: 'get_relationship_profile',
    description: '读取某个联系人的克隆画像（说话风格、性格、口头禅、回复习惯、关系与边界、最近样本）。未克隆时返回其克隆状态。',
    inputSchema: z.object({ contactId: z.string().min(1).describe('联系人 wxid / 会话 id') }),
    profiles: ['desktop-chat', 'wechat-bot', 'cron'],
    risk: 'read',
    parallelSafe: true,
    summarize: (i) => `读取 ${i.contactId} 的画像`,
    async execute(input, ctx) {
      const { relationships, substrate } = ctx.services
      if (ctx.profile === 'wechat-bot' && ctx.origin?.chatId && ctx.origin.chatId !== input.contactId) {
        return fail('机器人只能读取当前会话对象的画像。')
      }
      const profile = await relationships.get(input.contactId)
      if (!profile) {
        const status = await relationships.status(input.contactId)
        let name = input.contactId
        try {
          const c = await substrate.getContact(input.contactId)
          if (c) name = c.remark || c.nickname || name
        } catch {
          /* name is optional */
        }
        const state =
          status.state === 'building'
            ? `正在克隆（${status.progress.step}，${status.progress.done}/${status.progress.total}）`
            : status.state === 'failed'
              ? `上次克隆失败：${status.error}`
              : '尚未克隆'
        return ok(`「${name}」（${input.contactId}）${state}。`)
      }
      const { card, deep } = profile
      const lines = [
        `「${profile.displayName}」（${profile.contactId}）画像 v${profile.version}，${profile.samples.length} 组样本`,
        `语气：${card.tone.join('、') || '—'}`,
        `性格：${card.traits.join('、') || '—'}`,
        `口头禅：${card.catchphrases.join('、') || '—'}`,
        `标点习惯：${card.punctuation || '—'}`,
        `称呼：自称「${card.addressing.self ?? '—'}」，称对方「${card.addressing.other ?? '—'}」`,
        `常聊话题：${card.topics.join('、') || '—'}`,
        `回复习惯：${Object.entries(card.replyHabits).map(([k, v]) => `${k}→${v}`).join('；') || '—'}`,
        `关系：${deep.relationship || '—'}`,
        `近况与事实：${deep.facts.join('；') || '—'}`,
        `反应模式：${deep.reactionPatterns.join('；') || '—'}`,
        `边界：${deep.boundaries.join('；') || '—'}`,
        `共同经历：${deep.sharedEvents.map((e) => (e.when ? `${e.when} ${e.what}` : e.what)).join('；') || '—'}`,
      ]
      const samples = recentSamples(profile.samples, 5)
      if (samples.length) {
        lines.push('最近样本：')
        for (const s of samples) lines.push(`- 对方：${truncateChars(s.prompt, 80)} → 回：${truncateChars(s.reply, 120)}`)
      }
      if (profile.corrections.length) lines.push(`用户修正 ${profile.corrections.length} 条（已应用到画像）`)
      return ok(lines.join('\n'))
    },
  })
  return [get]
}
