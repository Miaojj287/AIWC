/**
 * Auto-reply rule model and the reply desk (drafts awaiting confirmation).
 *
 * Deliberately small: a rule is "this chat replies automatically, with THIS text" or "…with an AI
 * reply written under THIS system prompt, looking back THIS many messages". Every earlier knob
 * (trigger / schedule / style / persona / confirm-before-send) was a way for the feature to look
 * configured while silently never sending, so none of them exists any more.
 */
import type { Millis } from './ids'
import type { SessionSource } from './gateway'

export type ReplySource = 'fixed' | 'ai'

/** Choices offered for `historyCount`; free values in that range are accepted too. */
export const HISTORY_COUNT_OPTIONS = [10, 20, 30, 50, 100, 200] as const
export const DEFAULT_HISTORY_COUNT = 30
export const MIN_HISTORY_COUNT = 1
export const MAX_HISTORY_COUNT = 500

export interface AutoReplyRule {
  id: string
  sessionId: string
  /** Local WeChat account owning this rule. */
  accountId?: string
  enabled: boolean
  source: ReplySource
  /** source 'fixed': sent verbatim, supports {昵称} {时间} {群名} */
  fixedText?: string
  /** source 'ai': the system prompt the reply is written under */
  prompt?: string
  /** source 'ai': how many past messages of this chat the model sees */
  historyCount: number
  updatedAt: Millis
  /** derived */
  todayCount?: number
  pausedReason?: string
}

export type ReplyRecordStatus = 'sent' | 'pending' | 'failed' | 'recalled' | 'rejected'

export interface AutoReplyRecord {
  id: string
  ruleId: string
  sessionId: string
  triggerMessage: { id: string; text: string; senderName?: string; at: Millis }
  replyText: string
  at: Millis
  status: ReplyRecordStatus
  error?: string
  /** recall is possible within 2 minutes when the channel supports it */
  recallableUntil?: Millis
}

export type DraftState = 'pending' | 'approved' | 'sending' | 'sent' | 'rejected' | 'expired' | 'failed'

/** A reply waiting to be sent: auto-reply drafts count down, Agent handoffs wait in the reply desk. */
export interface ReplyDraft {
  id: string
  ruleId?: string
  source: SessionSource
  triggerMessageId: string
  triggerText: string
  draft: string
  suggestions?: string[]
  recordId?: string
  contextToken?: string
  accountId?: string
  state: DraftState
  createdAt: Millis
  expiresAt?: Millis
  /** 'suggest' = show only, 'confirm' = needs approval, 'auto' = countdown then send */
  mode: 'suggest' | 'confirm' | 'auto'
  countdownEndsAt?: Millis
  error?: string
}
