/**
 * Demo fixture format (dev/fixtures/*.json). Validated with zod on load; `anchor` on messages is
 * optional in the file and derived when absent. Never ship Figma placeholder data in a fixture.
 */
import { z } from 'zod'
import type { WxAccount, WxContact, WxMessage, WxSession } from '@aiwc/protocol'

export const SessionKindSchema = z.enum(['dm', 'group', 'official', 'system'])
export const ContactKindSchema = z.enum(['friend', 'group', 'official', 'stranger'])
export const MessageKindSchema = z.enum([
  'text', 'image', 'voice', 'video', 'file', 'sticker', 'link', 'card', 'location', 'transfer', 'quote', 'system', 'revoke', 'other',
])

export const WxAccountSchema = z.object({
  wxid: z.string().min(1),
  nickname: z.string().optional(),
  avatarPath: z.string().optional(),
  dbRoot: z.string().default(''),
  verified: z.boolean().default(true),
})

export const WxSessionSchema = z.object({
  id: z.string().min(1),
  kind: SessionKindSchema.optional(),
  title: z.string().default(''),
  avatarPath: z.string().optional(),
  lastMessageAt: z.number().optional(),
  lastPreview: z.string().optional(),
  lastSender: z.string().optional(),
  unread: z.number().int().nonnegative().default(0),
  pinned: z.boolean().default(false),
  muted: z.boolean().default(false),
  memberCount: z.number().int().nonnegative().optional(),
})

export const WxContactSchema = z.object({
  username: z.string().min(1),
  nickname: z.string().default(''),
  remark: z.string().optional(),
  alias: z.string().optional(),
  avatarPath: z.string().optional(),
  kind: ContactKindSchema.optional(),
  lastContactAt: z.number().optional(),
})

export const WxMediaSchema = z.object({
  kind: z.enum(['image', 'voice', 'video', 'file', 'sticker']),
  path: z.string().optional(),
  thumbPath: z.string().optional(),
  durationMs: z.number().optional(),
  sizeBytes: z.number().optional(),
  fileName: z.string().optional(),
  transcript: z.string().optional(),
})

export const MessageAnchorSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  seq: z.number(),
  createdAt: z.number(),
})

export const WxMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number(),
  createdAt: z.number(),
  senderId: z.string().default(''),
  senderName: z.string().optional(),
  isSelf: z.boolean().default(false),
  kind: MessageKindSchema.default('text'),
  text: z.string().default(''),
  media: WxMediaSchema.optional(),
  quote: z.object({ senderName: z.string().optional(), text: z.string() }).optional(),
  anchor: MessageAnchorSchema.optional(),
})

export const FixtureSchema = z.object({
  version: z.literal(1),
  account: WxAccountSchema,
  sessions: z.array(WxSessionSchema).default([]),
  contacts: z.array(WxContactSchema).default([]),
  groupMembers: z.record(z.string(), z.array(z.string())).default({}),
  messages: z.array(WxMessageSchema).default([]),
})

export type FixtureInput = z.input<typeof FixtureSchema>
export type Fixture = z.output<typeof FixtureSchema>

/** Fully normalised fixture: kinds resolved, anchors derived, messages sorted by (session, seq). */
export interface NormalisedFixture {
  account: WxAccount
  sessions: WxSession[]
  contacts: WxContact[]
  groupMembers: Record<string, string[]>
  messages: WxMessage[]
}
