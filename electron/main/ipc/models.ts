/**
 * 设置 › 用量与记录 and 设置 › AI 接入 › 网络: usage roll-ups, the call log and the proxy test. Thin: validate → service.
 */
import { z } from 'zod'
import { MODEL_USAGE_FEATURES } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

const DaysSchema = z.object({ days: z.number().int().min(1).max(366) })
const ListSchema = z.object({
  limit: z.number().int().min(1).max(200),
  before: z.object({ at: z.number().int().nonnegative(), id: z.string().min(1).max(64) }).optional(),
  feature: z.enum(MODEL_USAGE_FEATURES).optional(),
})
const IdSchema = z.object({ id: z.string().min(1).max(64) })
/** The renderer may only point the probe at a plain web address. */
const TestProxySchema = z.object({
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value)
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      } catch {
        return false
      }
    })
    .optional(),
})

export function registerModelsIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { usage } = ctx.modelOps
  handle('models:usageSummary', (req) => usage.summary(DaysSchema.parse(req).days))
  handle('models:clearUsage', () => usage.clearUsage())
  handle('models:listCalls', (req) => usage.listCalls(ListSchema.parse(req)))
  handle('models:getCall', (req) => usage.getCall(IdSchema.parse(req).id))
  handle('models:clearCalls', () => usage.clearCalls())
  handle('models:testProxy', (req) => ctx.modelOps.testProxy(TestProxySchema.parse(req ?? {}).url))
}
