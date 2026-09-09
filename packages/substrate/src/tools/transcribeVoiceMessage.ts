/**
 * transcribe_voice_message — run STT on one voice message via the substrate (local model or the
 * configured online provider). Not parallel-safe: local STT is CPU-heavy. Not offered to the
 * wechat-bot profile.
 */
import type { ToolProfile } from '@aiwc/protocol'
import { z } from 'zod'
import { anchorOf, anchorsMeta, defineSubstrateTool, describeToolError, fail, fmtTime, ok, squash } from './shared'

const TranscribeInput = z.object({
  sessionId: z.string().trim().min(1).describe('语音消息所在会话 id（anchor.sessionId）'),
  messageId: z.string().trim().min(1).describe('语音消息 id（anchor.messageId）'),
  force: z.boolean().default(false).describe('忽略已有转写结果重新识别；仅在用户明确要求时使用'),
})

export type TranscribeInput = z.infer<typeof TranscribeInput>

const PROFILES: readonly ToolProfile[] = ['desktop-chat', 'cron', 'subagent']

export const transcribeVoiceMessage = defineSubstrateTool({
  name: 'transcribe_voice_message',
  description:
    '把 get_context / get_timeline 返回的语音消息转成文字。仅在语音内容会影响结论时调用；sessionId、messageId 直接用消息 anchor 里的值。默认复用已有转写；只有用户明确要求重新识别才传 force=true。本地模型在本机识别，不出本机；在线模式会把音频发给你配置的服务商。\n' +
    'Transcribe one voice message (local STT or the configured online provider). Pass the anchor\'s sessionId / messageId; force=true re-runs recognition.',
  inputSchema: TranscribeInput,
  profiles: PROFILES,
  risk: 'read',
  parallelSafe: false,
  timeoutMs: 180_000,
  summarize: (i) => `转写语音（${i.sessionId} · ${i.messageId}）`,
  async execute(input, ctx) {
    const substrate = ctx.services.substrate
    if (typeof substrate.transcribeVoice !== 'function') {
      return fail('当前未配置语音转文字：请在「设置 › AI 接入 › 语音转文字」下载本地模型或配置在线服务。', {
        sessionId: input.sessionId,
        messageId: input.messageId,
      })
    }
    try {
      const message = await substrate.getMessage(input.sessionId, input.messageId)
      if (!message) {
        return fail('找不到该消息：会话可能尚未同步，或 messageId 无效。', { sessionId: input.sessionId, messageId: input.messageId })
      }
      if (message.kind !== 'voice') {
        return fail(`该消息不是语音（kind=${message.kind}），无需转写。`, { sessionId: input.sessionId, messageId: input.messageId, kind: message.kind })
      }
      const anchor = anchorOf(message)
      const cached = message.media?.transcript?.trim()
      if (cached && !input.force) {
        return ok({ anchor, time: fmtTime(message.createdAt), sender: message.isSelf ? '我' : message.senderName || message.senderId, text: cached, cached: true }, anchorsMeta([anchor]))
      }
      ctx.progress('正在识别语音…')
      const text = await substrate.transcribeVoice(input.sessionId, input.messageId, { force: input.force })
      const trimmed = squash(text, 4000)
      return ok(
        {
          anchor,
          time: fmtTime(message.createdAt),
          sender: message.isSelf ? '我' : message.senderName || message.senderId,
          durationMs: message.media?.durationMs ?? null,
          text: trimmed,
          cached: false,
          ...(trimmed ? {} : { note: '识别结果为空：可能是静音、噪音或不支持的语言。' }),
        },
        anchorsMeta([anchor]),
      )
    } catch (error) {
      return fail(describeToolError(error, 'transcribe_voice_message 执行失败'), { sessionId: input.sessionId, messageId: input.messageId })
    }
  },
})
