/**
 * jev:* — key test for 设置 › AI 接入 › Jev and the rule editor's dry run. Renderer input is untrusted:
 * the endpoint must be http(s), the rule's Jev config is re-validated with the protocol schema.
 */
import { JevRuleConfigSchema, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT, type AutoReplyRule } from '@aiwc/protocol'
import { z } from 'zod'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import { createInboundNameResolver } from '../services/autoReplyNames'
import { previewJevReply } from '../services/jevReply'
import type { Handle, HostBridge } from './register'

const HttpUrl = z
  .string()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  })

const TestRequest = z.object({
  apiKey: z.string().max(512).optional(),
  baseUrl: HttpUrl.optional(),
  model: z.string().max(128).optional(),
})

/** Only what the dry run reads; the rest of the rule is ignored rather than trusted. */
const PreviewRule = z.object({
  sessionId: z.string().min(1),
  historyCount: z.number().int().min(MIN_HISTORY_COUNT).max(MAX_HISTORY_COUNT).optional(),
  jev: JevRuleConfigSchema,
})

export function registerJevIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  handle('jev:test', (req) => {
    const parsed = TestRequest.safeParse(req ?? {})
    if (!parsed.success) throw new Error(t('main.jev.invalidEndpoint'))
    return ctx.jev.test(parsed.data)
  })
  handle('jev:preview', async ({ sessionId, rule }) => {
    const parsed = PreviewRule.safeParse(rule)
    if (typeof sessionId !== 'string' || !sessionId || !parsed.success || parsed.data.sessionId !== sessionId)
      throw new Error(t('main.jev.invalidRule'))
    const draft: AutoReplyRule = {
      id: '',
      sessionId,
      enabled: true,
      source: 'jev',
      historyCount: parsed.data.historyCount ?? MIN_HISTORY_COUNT,
      sendMode: 'confirm',
      updatedAt: 0,
      jev: parsed.data.jev,
    }
    return previewJevReply(
      { substrate: ctx.substrate, jev: ctx.jev, resolveNames: createInboundNameResolver(ctx.substrate) },
      sessionId,
      draft,
    )
  })
}
