import { z } from 'zod'
import type { KeyAcquireStep } from './keyAcquire'
import {
  WechatAcquireRequestSchema,
  WechatAcquireResultSchema,
  WechatDatabaseCoverageSchema,
  WechatDatabaseReadySchema,
  WechatDbCredentialBundleSchema,
  WechatKeyStepSchema,
} from './wechatCredentials'

/** Only stable progress fields cross from credential processing to renderer feedback. */
function sanitizeWechatKeyStep(step: KeyAcquireStep): KeyAcquireStep {
  return {
    id: step.id,
    label: '',
    status: step.status,
    ...(step.phase === undefined ? {} : { phase: step.phase }),
    ...(step.failure === undefined ? {} : { failure: step.failure }),
    ...(step.waitUntil === undefined ? {} : { waitUntil: step.waitUntil }),
  }
}

const SafeStepSchema = WechatKeyStepSchema.transform(sanitizeWechatKeyStep)
const HostResultSchema = WechatAcquireResultSchema.extend({ steps: z.array(SafeStepSchema).max(4) }).strict()

/** Private main-to-utility messages, including persistence and delivery acknowledgements. */
export const WechatKeyHostInputSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('init'),
      request: WechatAcquireRequestSchema,
      nativeDir: z.string().min(1).max(4096),
      dbKeyHex: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
      dbCredentials: WechatDbCredentialBundleSchema.optional(),
      operation: z.enum(['acquire', 'inspect']),
    })
    .strict(),
  z.object({ type: z.literal('cancel') }).strict(),
  z.object({ type: z.literal('database_ack'), accepted: z.boolean() }).strict(),
  z.object({ type: z.literal('final_ack') }).strict(),
])

/** Private utility-to-main messages; arbitrary diagnostic text cannot enter UI payloads. */
export const WechatKeyHostOutputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), step: SafeStepSchema }).strict(),
  z.object({ type: z.literal('database'), database: WechatDatabaseReadySchema }).strict(),
  z.object({ type: z.literal('result'), result: HostResultSchema }).strict(),
  z.object({ type: z.literal('coverage'), result: WechatDatabaseCoverageSchema }).strict(),
  z.object({ type: z.literal('failed') }).strict(),
])

/** Private lifecycle input; values never reach a renderer channel. */
export type WechatKeyHostInput = z.infer<typeof WechatKeyHostInputSchema>
/** Private lifecycle output; database material stays in the main process. */
export type WechatKeyHostOutput = z.infer<typeof WechatKeyHostOutputSchema>
