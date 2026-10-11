/**
 * Rule helpers over the gateway's AutoReplyRecordStore (records.db owns rules, records and drafts).
 * Pure functions so the IPC layer stays thin and the behaviour is unit-testable with a fake store.
 */
import {
  DEFAULT_HISTORY_COUNT,
  JEV_MAX_CANDIDATES,
  MAX_HISTORY_COUNT,
  MIN_HISTORY_COUNT,
  normaliseJevRuleConfig,
  type AutoReplyRule,
} from '@aiwc/protocol'
import { nanoid } from 'nanoid'
import { t } from '../i18n'

/** Assign an id when missing, trim the editable text, stamp updatedAt. Never mutates the input. */
export function normaliseRule(rule: AutoReplyRule, now = Date.now()): AutoReplyRule {
  return {
    ...rule,
    id: rule.id && rule.id.length > 0 ? rule.id : `rule_${nanoid(10)}`,
    source: rule.source === 'ai' ? 'ai' : rule.source === 'jev' ? 'jev' : 'fixed',
    fixedText: rule.fixedText?.trim() || undefined,
    prompt: rule.prompt?.trim() || undefined,
    jev: rule.source === 'jev' ? normaliseJevRuleConfig(rule.jev) : undefined,
    historyCount: clampHistoryCount(rule.historyCount),
    sendMode: rule.sendMode === 'confirm' ? 'confirm' : 'auto',
    updatedAt: now,
  }
}

export function clampHistoryCount(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_COUNT
  return Math.max(MIN_HISTORY_COUNT, Math.min(MAX_HISTORY_COUNT, n))
}

/** Returns a user-facing error message, or undefined when the rule can be saved. */
export function validateRule(rule: AutoReplyRule): string | undefined {
  if (!rule.sessionId) return t('main.autoReply.missingSession')
  if (rule.source !== 'fixed' && rule.source !== 'ai' && rule.source !== 'jev')
    return t('main.autoReply.unsupportedSource')
  if (rule.sendMode !== undefined && rule.sendMode !== 'confirm' && rule.sendMode !== 'auto')
    return t('main.autoReply.unsupportedSendMode')
  if (rule.source === 'fixed' && !rule.fixedText?.trim()) return t('main.autoReply.fixedTextEmpty')
  if (rule.source === 'ai' || rule.source === 'jev') {
    const n = Number(rule.historyCount)
    if (!Number.isInteger(n) || n < MIN_HISTORY_COUNT || n > MAX_HISTORY_COUNT)
      return t('main.autoReply.historyCountRange', { min: MIN_HISTORY_COUNT, max: MAX_HISTORY_COUNT })
  }
  if (rule.source === 'jev') {
    const candidates = normaliseJevRuleConfig(rule.jev).candidates
    if (candidates.length === 0) return t('main.jev.noCandidates')
    if (candidates.length > JEV_MAX_CANDIDATES) return t('main.jev.tooManyCandidates', { max: JEV_MAX_CANDIDATES })
  }
  return undefined
}
