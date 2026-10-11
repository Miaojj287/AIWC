/**
 * One-line summary of a Jev decision under a record: the pick with its confidence, the runner-ups on
 * hover, and the 等你确认 note when the confidence gate parked it. Only records of Jev rules carry one.
 */
import type { JevDecision } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { cn } from '@/kit'
import { decisionSummary, percent } from './jevModel'

export function JevDecisionLine({ decision, className }: { decision: JevDecision; className?: string }) {
  const t = useT()
  const summary = decisionSummary(decision)
  return (
    <span className={cn('flex min-w-0 flex-col gap-0.5 text-micro text-fg-3', className)} data-testid="jev-decision">
      <span className="truncate" title={summary.others || undefined}>
        {summary.line}
      </span>
      {decision.outcome === 'confirm' ? (
        <span className="truncate text-warn">
          {t('autoreply.jev.records.uncertain', { confidence: percent(decision.confidence) })}
        </span>
      ) : null}
    </span>
  )
}
