/**
 * Auto-reply rule model helpers: defaults, validation, dirty check and the list status line.
 * Pure — tested in ruleModel.test.ts.
 *
 * A rule has one switch and one decision (固定文案 / AI 生成). Anything that could make an enabled
 * rule stay silent — trigger conditions, time windows, a per-rule "confirm first" — is gone on
 * purpose: an enabled rule replies, and that is the whole contract.
 */
import { DEFAULT_HISTORY_COUNT, HISTORY_COUNT_OPTIONS, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT, type AutoReplyRule, type ReplySource } from '@aiwc/protocol'

export const RULE_VARIABLES = ['{昵称}', '{时间}', '{群名}'] as const

export const SOURCE_OPTIONS: ReadonlyArray<{ value: ReplySource; label: string }> = [
  { value: 'fixed', label: '固定文案' },
  { value: 'ai', label: 'AI 生成' },
]

export { DEFAULT_HISTORY_COUNT, HISTORY_COUNT_OPTIONS, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT }

export function newRule(sessionId: string): AutoReplyRule {
  return {
    id: '',
    sessionId,
    enabled: true,
    source: 'ai',
    fixedText: '',
    prompt: '',
    historyCount: DEFAULT_HISTORY_COUNT,
    updatedAt: 0,
  }
}

export interface RuleErrors {
  fixedText?: string
  historyCount?: string
}

export function validateRule(rule: AutoReplyRule): RuleErrors {
  const errors: RuleErrors = {}
  if (rule.source === 'fixed' && !(rule.fixedText ?? '').trim()) errors.fixedText = '固定文案不能为空'
  if (rule.source === 'ai') {
    const n = Number(rule.historyCount)
    if (!Number.isInteger(n) || n < MIN_HISTORY_COUNT || n > MAX_HISTORY_COUNT) errors.historyCount = `请填 ${MIN_HISTORY_COUNT} – ${MAX_HISTORY_COUNT} 之间的整数`
  }
  return errors
}

export const isRuleValid = (errors: RuleErrors): boolean => Object.keys(errors).length === 0

/** Fields the user edits; derived / bookkeeping fields are ignored when comparing. */
export function rulesEqual(a: AutoReplyRule, b: AutoReplyRule): boolean {
  const pick = (r: AutoReplyRule) => ({
    sessionId: r.sessionId,
    enabled: r.enabled,
    source: r.source,
    fixedText: r.fixedText ?? '',
    prompt: r.prompt ?? '',
    historyCount: r.historyCount ?? DEFAULT_HISTORY_COUNT,
  })
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b))
}

export type RuleStatusKind = 'on' | 'paused' | 'unset'

export interface RuleStatusLine {
  kind: RuleStatusKind
  text: string
}

export function sourceLabel(source: ReplySource): string {
  return SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source
}

/** Second line of a session in the auto-reply list. */
export function ruleStatusLine(rule: AutoReplyRule | undefined): RuleStatusLine {
  if (!rule) return { kind: 'unset', text: '未设置' }
  if (!rule.enabled) return { kind: 'paused', text: rule.pausedReason ? `已暂停 · ${rule.pausedReason}` : '已暂停' }
  if (rule.pausedReason) return { kind: 'paused', text: `已暂停 · ${rule.pausedReason}` }
  const parts = ['已开启', sourceLabel(rule.source)]
  if (rule.source === 'ai') parts.push(`参考 ${rule.historyCount ?? DEFAULT_HISTORY_COUNT} 条`)
  if (rule.todayCount) parts.push(`今日 ${rule.todayCount} 次`)
  return { kind: 'on', text: parts.join(' · ') }
}

export type RuleSegment = 'all' | 'on' | 'paused'

export function matchesSegment(rule: AutoReplyRule | undefined, segment: RuleSegment): boolean {
  if (segment === 'all') return true
  const kind = ruleStatusLine(rule).kind
  return segment === 'on' ? kind === 'on' : kind === 'paused'
}

/** Insert `token` at the caret; returns the new text and caret position (after the token). */
export function insertAtCursor(text: string, cursor: number, token: string): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length))
  return { text: text.slice(0, at) + token + text.slice(at), cursor: at + token.length }
}

/** Copy a rule to another session (new id, same behaviour). */
export function copyRuleTo(rule: AutoReplyRule, sessionId: string): AutoReplyRule {
  return { ...rule, id: '', sessionId, todayCount: undefined, pausedReason: undefined }
}
