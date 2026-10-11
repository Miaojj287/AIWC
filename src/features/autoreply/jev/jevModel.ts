/**
 * Pure helpers for the Jev（beta） reply-source UI: candidate list edits, the options of a decision in
 * display order, percentages and tones. Tested in jevModel.test.ts.
 */
import {
  JEV_CONFIDENCE_OPTIONS,
  JEV_MAX_CANDIDATES,
  JEV_SILENCE_OPTION,
  defaultJevRuleConfig,
  type AutoReplyRule,
  type JevDecision,
  type JevOutcome,
  type JevRuleConfig,
} from '@aiwc/protocol'
import { t } from '@/i18n'

export { JEV_CONFIDENCE_OPTIONS, JEV_MAX_CANDIDATES }

export const percent = (p: number): number => Math.round(Math.min(1, Math.max(0, p)) * 100)

/** The rule's Jev config with defaults filled in, for editing. */
export const jevConfigOf = (rule: Pick<AutoReplyRule, 'jev'>): JevRuleConfig => rule.jev ?? defaultJevRuleConfig()

export function setCandidate(config: JevRuleConfig, index: number, text: string): JevRuleConfig {
  const candidates = [...config.candidates]
  candidates[index] = text
  return { ...config, candidates }
}

export function addCandidate(config: JevRuleConfig): JevRuleConfig {
  if (config.candidates.length >= JEV_MAX_CANDIDATES) return config
  return { ...config, candidates: [...config.candidates, ''] }
}

export function removeCandidate(config: JevRuleConfig, index: number): JevRuleConfig {
  return { ...config, candidates: config.candidates.filter((_, i) => i !== index) }
}

export const canAddCandidate = (config: JevRuleConfig): boolean => config.candidates.length < JEV_MAX_CANDIDATES

export interface DecisionOption {
  id: string
  /** Candidate text, or the localized 不回复 for the silence option. */
  label: string
  probability: number
  chosen: boolean
  silence: boolean
}

/** Every option Jev weighed, most likely first; the silence option carries its own label. */
export function decisionOptions(decision: JevDecision): DecisionOption[] {
  return Object.entries(decision.probabilities)
    .map(([id, probability]) => ({
      id,
      label: id === JEV_SILENCE_OPTION ? t('autoreply.jev.records.silence') : (decision.options[id] ?? id),
      probability,
      chosen: id === decision.choice,
      silence: id === JEV_SILENCE_OPTION,
    }))
    .sort((a, b) => b.probability - a.probability)
}

/** Label of what Jev picked (the candidate text or 不回复). */
export function chosenLabel(decision: JevDecision): string {
  return decision.choice === JEV_SILENCE_OPTION
    ? t('autoreply.jev.records.silence')
    : (decision.options[decision.choice] ?? decision.choice)
}

export type OutcomeTone = 'ok' | 'warn' | 'neutral'

export const outcomeTone = (outcome: JevOutcome): OutcomeTone =>
  outcome === 'send' ? 'ok' : outcome === 'confirm' ? 'warn' : 'neutral'

/** `Jev 82% · 好的收到` for a record line, with the runner-ups for a title. */
export function decisionSummary(decision: JevDecision): { line: string; others: string } {
  const options = decisionOptions(decision)
  const line = t('autoreply.jev.records.line', {
    confidence: percent(decision.confidence),
    choice: chosenLabel(decision),
  })
  const others = options
    .filter((o) => !o.chosen)
    .slice(0, 3)
    .map((o) => `${o.label} ${percent(o.probability)}%`)
    .join(' · ')
  return { line, others: others ? t('autoreply.jev.records.others', { list: others }) : '' }
}
