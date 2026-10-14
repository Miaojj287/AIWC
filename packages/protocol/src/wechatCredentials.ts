import { z } from 'zod'
import { AccountTargetSchema } from './wechatKeys'
import { KEY_ACQUIRE_PHASES, KEY_ACQUIRE_FAILURES } from './keyAcquire'

const KEY_HEX = /^[0-9a-f]{64}$/
const SALT_HEX = /^[0-9a-f]{32}$/
const RelativeDatabasePathSchema = z
  .string()
  .max(512)
  .refine(
    (value) =>
      value.endsWith('.db') &&
      value.split('/').every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'),
  )

/** Private per-file material; never send this schema's values to the renderer. */
export const WechatDbCredentialBundleSchema = z
  .object({
    version: z.literal(1),
    accountId: AccountTargetSchema.shape.wxid,
    entries: z
      .array(
        z
          .object({
            relativePath: RelativeDatabasePathSchema,
            saltHex: z.string().regex(SALT_HEX),
            keyHex: z.string().regex(KEY_HEX),
            form: z.enum(['direct', 'raw']),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .refine((bundle) => new Set(bundle.entries.map((entry) => entry.relativePath)).size === bundle.entries.length)

/** An account-bound credential collection stored only in safeStorage. */
export type WechatDbCredentialBundle = z.infer<typeof WechatDbCredentialBundleSchema>

/** Capabilities the UI may inspect without seeing private material. */
export const WechatCredentialStatusSchema = z.object({
  database: z.boolean(),
  imageXor: z.boolean(),
  imageAes: z.boolean(),
  matched: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  missing: z.array(RelativeDatabasePathSchema),
  revision: z.number().int().nonnegative(),
})
/** Safe connection and media availability for the selected account. */
export type WechatCredentialStatus = z.infer<typeof WechatCredentialStatusSchema>

/** Output of the version-bound native helper, carried only over a private pipe. */
export const WechatCodecResultSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['ok', 'needs_authorization', 'unsupported_version', 'not_found', 'timeout', 'process_exited']),
    entries: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(127),
            saltHex: z.string().regex(SALT_HEX),
            keyHex: z.string().regex(KEY_HEX),
            form: z.literal('direct'),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .refine((value) => new Set(value.entries.map((entry) => entry.index)).size === value.entries.length)

/** Validated wire request for a user-initiated utility-process acquisition. */
export const WechatAcquireRequestSchema = AccountTargetSchema.pick({ wxid: true, dbRoot: true }).extend({
  strategy: z.enum(['auto', 'memory_scan']).default('auto'),
  scope: z.enum(['all', 'database', 'image']).default('database'),
})
/** Acquisition request without process-local callbacks or native paths. */
export type WechatAcquireRequest = z.infer<typeof WechatAcquireRequestSchema>

/** Validated progress over the private host connection. */
export const WechatKeyStepSchema = z.object({
  id: z.enum(['db_key', 'image_xor', 'image_aes', 'verify']),
  label: z.string(),
  status: z.enum(['todo', 'doing', 'done', 'failed']),
  detail: z.string().optional(),
  phase: z.enum(KEY_ACQUIRE_PHASES).optional(),
  failure: z.enum(KEY_ACQUIRE_FAILURES).optional(),
  waitUntil: z.number().optional(),
})
/** Private database commit payload. */
export const WechatDatabaseReadySchema = z.object({
  dbKeyHex: z.string().regex(KEY_HEX),
  dbCredentials: WechatDbCredentialBundleSchema.optional(),
  currentPaths: z.array(RelativeDatabasePathSchema).max(128).optional(),
})
/** Private acquisition output; its steps alone may reach the renderer. */
export const WechatAcquireResultSchema = z.object({
  dbKeyHex: z.string().regex(KEY_HEX).optional(),
  dbCredentials: WechatDbCredentialBundleSchema.optional(),
  imageXorHex: z
    .string()
    .regex(/^[0-9a-f]{2}$/)
    .optional(),
  imageAesHex: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  steps: z.array(WechatKeyStepSchema),
  cancelled: z.boolean().optional(),
})
/** Page-authenticated database coverage without credentials. */
export const WechatDatabaseCoverageSchema = WechatCredentialStatusSchema.pick({
  database: true,
  matched: true,
  total: true,
  missing: true,
})

/** Renderer-safe connection channels; private material never appears in their results. */
export interface WechatCredentialsInvokeMap {
  'substrate:credentialStatus': { req: z.infer<typeof AccountTargetSchema>; res: WechatCredentialStatus }
}
/** Connection capability channel names. */
export const WECHAT_CREDENTIALS_INVOKE_CHANNELS = ['substrate:credentialStatus'] as const
