/**
 * Auto-reply rule model helpers: defaults, validation, dirty check and the list status line.
 * Pure — tested in ruleModel.test.ts.
 *
 * A rule has one switch and two decisions: what to reply (固定文案 / AI 生成) and how it leaves
 * (自动回复 = parked until 确认发送, 全自动回复 = countdown then send). Both are visible in the
 * editor and on the list row; nothing hidden can keep an enabled rule silent.
 */
import {
  DEFAULT_HISTORY_COUNT,
  DEFAULT_SEND_MODE,
  HISTORY_COUNT_OPTIONS,
  MAX_HISTORY_COUNT,
  MIN_HISTORY_COUNT,
  type AutoReplyRule,
  type ReplySendMode,
  type ReplySource,
} from '@aiwc/protocol'
import { t, type MessageKey, type Translator } from '@/i18n'

// eslint-disable-next-line aiwc/no-hardcoded-cjk -- template tokens are stored rule syntax (gateway template.ts), inserted verbatim in every UI language
export const RULE_VARIABLES = ['{昵称}', '{时间}', '{群名}'] as const

/** Chip label per variable; the label only explains the token, the token itself is never translated. */
/* eslint-disable aiwc/no-hardcoded-cjk -- keys are the template tokens above (rule syntax), not UI copy */
export const RULE_VARIABLE_LABELS: Record<(typeof RULE_VARIABLES)[number], MessageKey> = {
  '{昵称}': 'autoreply.reply.variables.nickname',
  '{时间}': 'autoreply.reply.variables.time',
  '{群名}': 'autoreply.reply.variables.groupName',
}
/* eslint-enable aiwc/no-hardcoded-cjk */

export const SOURCE_OPTIONS: ReadonlyArray<{ value: ReplySource; labelKey: MessageKey }> = [
  { value: 'fixed', labelKey: 'autoreply.source.fixed' },
  { value: 'ai', labelKey: 'autoreply.source.ai' },
]

export const SEND_MODE_OPTIONS: ReadonlyArray<{
  value: ReplySendMode
  labelKey: MessageKey
  descriptionKey: MessageKey
}> = [
  { value: 'confirm', labelKey: 'autoreply.sendMode.confirm', descriptionKey: 'autoreply.sendMode.confirmDescription' },
  { value: 'auto', labelKey: 'autoreply.sendMode.auto', descriptionKey: 'autoreply.sendMode.autoDescription' },
]

export { DEFAULT_HISTORY_COUNT, DEFAULT_SEND_MODE, HISTORY_COUNT_OPTIONS, MAX_HISTORY_COUNT, MIN_HISTORY_COUNT }

export function newRule(sessionId: string): AutoReplyRule {
  return {
    id: '',
    sessionId,
    enabled: true,
    source: 'ai',
    fixedText: '',
    prompt: '',
    historyCount: DEFAULT_HISTORY_COUNT,
    sendMode: DEFAULT_SEND_MODE,
    updatedAt: 0,
  }
}

export interface RuleErrors {
  fixedText?: string
  historyCount?: string
}

/** `translate` defaults to the current language; the editor passes its `useT()` so messages follow a language switch. */
export function validateRule(rule: AutoReplyRule, translate: Translator = t): RuleErrors {
  const errors: RuleErrors = {}
  if (rule.source === 'fixed' && !(rule.fixedText ?? '').trim())
    errors.fixedText = translate('autoreply.validation.fixedTextEmpty')
  if (rule.source === 'ai') {
    const n = Number(rule.historyCount)
    if (!Number.isInteger(n) || n < MIN_HISTORY_COUNT || n > MAX_HISTORY_COUNT)
      errors.historyCount = translate('autoreply.validation.historyCountRange', {
        min: MIN_HISTORY_COUNT,
        max: MAX_HISTORY_COUNT,
      })
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
    sendMode: r.sendMode ?? 'auto',
  })
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b))
}

export type RuleStatusKind = 'on' | 'paused' | 'unset'

export interface RuleStatusLine {
  kind: RuleStatusKind
  text: string
}

export function sourceLabel(source: ReplySource): string {
  const key = SOURCE_OPTIONS.find((o) => o.value === source)?.labelKey
  return key ? t(key) : source
}

/** Second line of a session in the auto-reply list. */
export function ruleStatusLine(rule: AutoReplyRule | undefined): RuleStatusLine {
  if (!rule) return { kind: 'unset', text: t('autoreply.status.unset') }
  if (!rule.enabled)
    return {
      kind: 'paused',
      text: rule.pausedReason
        ? t('autoreply.status.pausedWithReason', { reason: rule.pausedReason })
        : t('autoreply.status.paused'),
    }
  if (rule.pausedReason)
    return { kind: 'paused', text: t('autoreply.status.pausedWithReason', { reason: rule.pausedReason }) }
  const parts = [
    rule.sendMode === 'confirm' ? t('autoreply.status.confirmFirst') : t('autoreply.status.autoSend'),
    sourceLabel(rule.source),
  ]
  if (rule.source === 'ai')
    parts.push(t('autoreply.rule.historyCount', { n: rule.historyCount ?? DEFAULT_HISTORY_COUNT }))
  if (rule.todayCount) parts.push(t('autoreply.status.todayCount', { n: rule.todayCount }))
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
