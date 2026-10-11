/**
 * 试一下 card: run the rule as drafted against the chat's last message (jev:preview) and show Jev's
 * whole answer — the pick, the outcome the gate would produce, every option's probability as a bar,
 * the needs-reply probability and the request's size. Nothing is sent or recorded; this is where the
 * user learns what the model actually does with their candidates.
 */
import { ExternalLink, FlaskConical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AutoReplyRule, JevPreview } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, EmptyState, InlineHint, ProgressBar, cn } from '@/kit'
import { invoke } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import { decisionOptions, outcomeTone, percent } from './jevModel'

const JEV_DOCS_URL = 'https://docs.typesafe.ai/'

export interface JevPreviewCardProps {
  sessionId: string
  draft: AutoReplyRule
  /** Why the dry run cannot start (no key / no candidates / invalid); undefined = allowed. */
  disabledReason: string | undefined
}

export function JevPreviewCard({ sessionId, draft, disabledReason }: JevPreviewCardProps) {
  const t = useT()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<JevPreview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const epoch = useRef(0)
  useEffect(
    () => () => {
      // A result that arrives after the tab unmounted must not reach state.
      epoch.current++
    },
    [],
  )

  const run = async () => {
    const request = ++epoch.current
    setRunning(true)
    setError(undefined)
    try {
      const preview = await invoke('jev:preview', { sessionId, rule: draft })
      if (request === epoch.current) setResult(preview)
    } catch (e) {
      if (request === epoch.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (request === epoch.current) setRunning(false)
    }
  }

  const decision = result?.decision
  const options = decision ? decisionOptions(decision) : []
  const tone = decision ? outcomeTone(decision.outcome) : 'neutral'

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold text-fg">{t('autoreply.jev.preview.section')}</h2>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="link" size="sm" icon={ExternalLink} onClick={() => void openUrl(JEV_DOCS_URL)}>
            {t('autoreply.jev.preview.docs')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={FlaskConical}
            loading={running}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
            onClick={() => void run()}
          >
            {running ? t('autoreply.jev.preview.running') : t('autoreply.jev.preview.run')}
          </Button>
        </span>
      </div>
      <Card variant="rows" className="overflow-hidden">
        {error ? (
          <div className="px-4 py-3">
            <InlineHint kind="error">{error}</InlineHint>
          </div>
        ) : null}
        {!result && !error ? (
          <EmptyState
            compact
            variant="empty"
            icon={FlaskConical}
            title={t('autoreply.jev.preview.emptyTitle')}
            description={t('autoreply.jev.preview.emptyDescription')}
          />
        ) : null}
        {result && decision ? (
          <div className="flex flex-col gap-4 px-4 py-3" data-testid="jev-preview-result">
            <div className="flex flex-col gap-1">
              <span className="text-micro text-fg-3">
                {t('autoreply.jev.preview.trigger', {
                  sender: result.trigger.senderName ?? '',
                  text: result.trigger.text,
                })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-micro text-fg-3">{t('autoreply.jev.preview.chosen')}</span>
                <span className="min-w-0 truncate text-body font-medium text-fg" title={result.text}>
                  {result.text ?? t('autoreply.jev.preview.silence')}
                </span>
                <Badge tone={tone}>{t(`autoreply.jev.preview.outcome.${decision.outcome}`)}</Badge>
              </div>
              <span className="text-micro text-fg-3">
                {[
                  t('autoreply.jev.preview.confidence', { n: percent(decision.confidence) }),
                  t('autoreply.jev.preview.threshold', { n: percent(decision.threshold) }),
                  decision.needsReply !== undefined
                    ? t('autoreply.jev.preview.needsReply', { n: percent(decision.needsReply) })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-micro text-fg-3">{t('autoreply.jev.preview.options')}</span>
              {options.map((option) => (
                <div key={option.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-caption',
                        option.chosen ? 'font-medium text-fg' : 'text-fg-2',
                        option.silence && 'italic',
                      )}
                      title={option.label}
                    >
                      {option.label}
                    </span>
                    <span className="shrink-0 font-latin text-micro text-fg-3">{percent(option.probability)}%</span>
                  </div>
                  <ProgressBar value={percent(option.probability)} label={option.label} />
                </div>
              ))}
            </div>
            <span className="font-latin text-micro text-fg-3">
              {decision.inputTokens !== undefined
                ? t('autoreply.jev.preview.meta', {
                    model: decision.model,
                    ms: decision.latencyMs,
                    tokens: decision.inputTokens,
                    chars: result.stateChars,
                  })
                : t('autoreply.jev.preview.metaNoTokens', {
                    model: decision.model,
                    ms: decision.latencyMs,
                    chars: result.stateChars,
                  })}
            </span>
          </div>
        ) : null}
      </Card>
    </section>
  )
}
