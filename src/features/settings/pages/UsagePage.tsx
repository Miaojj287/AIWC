/**
 * 设置 › 用量与记录 — model usage counted on this computer (tokens by day, feature and model; no cost estimate),
 * and the call log (CallLogSection). Refreshes when a call is recorded. Nothing here leaves the machine (§6).
 */
import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { USAGE_RANGE_DAYS, type UsageRangeDays, type UsageSummary, type UsageTotals } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, DangerDialog, EmptyState, ProgressBar, SegmentedControl, Tooltip, toast } from '@/kit'
import { formatNumber } from '@/platform/format'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../hooks'
import { PagePlaceholder, Section } from '../pageKit'
import { chartBars, formatTokens, sharePct, tokensOf } from '../usageModel'
import { CallLogSection } from './usage/CallLogSection'

/** Recorded calls arrive in bursts during a turn; refresh the totals at most this often. */
const REFRESH_MIN_MS = 3_000

export function UsagePage() {
  const t = useT()
  const [days, setDays] = useState<UsageRangeDays>(7)
  const [confirmClear, setConfirmClear] = useState(false)
  const [version, setVersion] = useState(0)
  const [lastRefresh, setLastRefresh] = useState(0)
  const summary = useInvoke('models:usageSummary', { days }, [days, version])
  useBridgeEvent('models:callRecorded', () => {
    const now = Date.now()
    if (now - lastRefresh < REFRESH_MIN_MS) return
    setLastRefresh(now)
    summary.reload()
  })

  const clear = async () => {
    try {
      await invoke('models:clearUsage', undefined)
      setVersion((v) => v + 1)
      toast.success(t('settings.usage.clear.done'))
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    }
  }

  const data = summary.data
  return (
    <>
      <Section
        id="usage.overview"
        title={t('settings.usage.sections.overview')}
        help={t('settings.usage.overviewHelp')}
        actions={
          <SegmentedControl<string>
            size="sm"
            aria-label={t('settings.usage.range.label')}
            options={USAGE_RANGE_DAYS.map((n) => ({ value: String(n), label: t('settings.usage.range.days', { n }) }))}
            value={String(days)}
            onValueChange={(v) => setDays(Number(v) as UsageRangeDays)}
          />
        }
      >
        {summary.loading && !data ? (
          <PagePlaceholder rows={3} />
        ) : summary.error && !data ? (
          <EmptyState
            bordered
            compact
            variant="error"
            title={t('settings.usage.loadFailed')}
            description={summary.error.message}
            action={{ label: t('common.retry'), onClick: summary.reload }}
          />
        ) : !data || data.totals.requests === 0 ? (
          <EmptyState
            bordered
            compact
            title={t('settings.usage.empty.title')}
            description={t('settings.usage.empty.description')}
          />
        ) : (
          <Overview summary={data} />
        )}
      </Section>

      {data && data.totals.requests > 0 ? (
        <>
          <Section title={t('settings.usage.sections.byFeature')}>
            <Card variant="rows">
              {data.byFeature.map((row) => (
                <ShareRow
                  key={row.feature}
                  label={t(`settings.usage.features.${row.feature}`)}
                  totals={row}
                  total={tokensOf(data.totals)}
                />
              ))}
            </Card>
          </Section>
          <Section title={t('settings.usage.sections.byModel')}>
            <Card variant="rows">
              {data.byModel.map((row) => (
                <ShareRow
                  key={`${row.providerId}::${row.modelId}`}
                  label={row.modelId}
                  mono
                  badge={row.local ? <Badge tone="ok">{t('settings.usage.calls.local')}</Badge> : undefined}
                  totals={row}
                  total={tokensOf(data.totals)}
                />
              ))}
            </Card>
          </Section>
        </>
      ) : null}

      <CallLogSection version={version} onCleared={() => setVersion((v) => v + 1)} />

      <div className="flex justify-end">
        <Button variant="outline" icon={Trash2} onClick={() => setConfirmClear(true)}>
          {t('settings.usage.clear.button')}
        </Button>
      </div>
      <DangerDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('settings.usage.clear.title')}
        description={t('settings.usage.clear.description')}
        confirmLabel={t('settings.usage.clear.confirm')}
        onConfirm={async () => {
          setConfirmClear(false)
          await clear()
        }}
      />
    </>
  )
}

function Overview({ summary }: { summary: UsageSummary }) {
  const t = useT()
  const bars = chartBars(summary.days)
  const stats: Array<{ label: string; value: string }> = [
    { label: t('settings.usage.totals.requests'), value: formatNumber(summary.totals.requests) },
    { label: t('settings.usage.totals.input'), value: formatTokens(summary.totals.inputTokens) },
    { label: t('settings.usage.totals.output'), value: formatTokens(summary.totals.outputTokens) },
    { label: t('settings.usage.totals.errors'), value: formatNumber(summary.totals.errors) },
  ]
  return (
    <Card className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 @min-[520px]/settings:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-1">
            <dt className="truncate text-caption text-fg-3">{s.label}</dt>
            <dd className="m-0 truncate text-title font-semibold leading-7 text-fg">{s.value}</dd>
          </div>
        ))}
      </dl>
      <div role="img" aria-label={t('settings.usage.chartLabel')} className="flex h-24 items-end gap-px">
        {bars.map((bar) => (
          <Tooltip
            key={bar.day}
            content={t('settings.usage.dayTooltip', {
              day: bar.day,
              tokens: formatTokens(bar.tokens),
              requests: bar.requests,
            })}
          >
            <div className="flex h-full min-w-0 flex-1 items-end hover:bg-hover-5">
              <div className="w-full bg-accent" style={{ height: `${bar.pct}%` }} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-micro text-fg-3">
        <span>{summary.days[0]?.day}</span>
        <span>{summary.days.at(-1)?.day}</span>
      </div>
    </Card>
  )
}

function ShareRow({
  label,
  badge,
  mono,
  totals,
  total,
}: {
  label: string
  badge?: ReactNode
  mono?: boolean
  totals: UsageTotals
  total: number
}) {
  const t = useT()
  const tokens = tokensOf(totals)
  const pct = sharePct(tokens, total)
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={mono ? 'min-w-0 truncate font-mono text-body text-fg' : 'min-w-0 truncate text-body text-fg'}>
          {label}
        </span>
        {badge}
        <span className="ml-auto shrink-0 text-caption text-fg-3">
          {t('settings.usage.row.requests', { n: totals.requests })} ·{' '}
          {t('settings.usage.row.tokens', { n: formatTokens(tokens) })}
          {totals.errors > 0 ? ` · ${t('settings.usage.row.errors', { n: totals.errors })}` : ''}
        </span>
      </div>
      <ProgressBar value={pct} label={`${label} ${Math.round(pct)}%`} />
    </div>
  )
}
