import { z } from 'zod'

/** Private output of the read-only image helper; values never reach the renderer. */
export const WechatImageScanResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    attached: z.literal(true),
    aesKeyHex: z.string().regex(/^[0-9a-fA-F]{32}$/),
  }),
  z.object({
    success: z.literal(false),
    attached: z.boolean(),
    attachCode: z.number().int().optional(),
    aesKeyHex: z.never().optional(),
  }),
])
