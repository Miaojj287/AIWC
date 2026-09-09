/**
 * Rule helpers over the gateway's AutoReplyRecordStore (records.db owns rules, records and drafts).
 * Pure functions so the IPC layer stays thin and the behaviour is unit-testable with a fake store.
 */
import { DEFAULT_HISTORY_COUNT, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT, type AutoReplyRule } from '@aiwc/protocol'
import type { AutoReplyRecordStore } from '@aiwc/gateway'
import { nanoid } from 'nanoid'

export type RuleStore = Pick<AutoReplyRecordStore, 'listRules' | 'getRule' | 'saveRule' | 'setEnabled' | 'deleteRule'>

/** Assign an id when missing, trim the editable text, stamp updatedAt. Never mutates the input. */
export function normaliseRule(rule: AutoReplyRule, now = Date.now()): AutoReplyRule {
  return {
    ...rule,
    id: rule.id && rule.id.length > 0 ? rule.id : `rule_${nanoid(10)}`,
    source: rule.source === 'ai' ? 'ai' : 'fixed',
    fixedText: rule.fixedText?.trim() || undefined,
    prompt: rule.prompt?.trim() || undefined,
    historyCount: clampHistoryCount(rule.historyCount),
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
  if (!rule.sessionId) return '规则缺少会话'
  if (rule.source !== 'fixed' && rule.source !== 'ai') return '不支持的回复方式'
  if (rule.source === 'fixed' && !rule.fixedText?.trim()) return '固定回复内容不能为空'
  if (rule.source === 'ai') {
    const n = Number(rule.historyCount)
    if (!Number.isInteger(n) || n < MIN_HISTORY_COUNT || n > MAX_HISTORY_COUNT) return `参考历史条数应在 ${MIN_HISTORY_COUNT} 到 ${MAX_HISTORY_COUNT} 之间`
  }
  return undefined
}
