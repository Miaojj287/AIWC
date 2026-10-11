/**
 * 调用记录 on 设置 › 用量与记录: the 记录内容 switch (off by default, §6 note behind its help), a feature filter, the
 * newest calls with paging, a row opens CallDetailDialog. Metadata only unless content was recorded for that call.
 */
import { CircleCheck, CircleSlash, CircleX, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MODEL_USAGE_FEATURES, type ModelCallRecord, type ModelUsageFeature } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, DangerDialog, EmptyState, ICON_STROKE, Select, Toggle, cn, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatDateTime } from '@/platform/format'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { errorMessage, saveConfig } from '../../hooks'
import { SRow, Section } from '../../pageKit'
import { USAGE_PAGE_SIZE, appendCalls, formatSeconds, formatTokens, nextCursor } from '../../usageModel'
import { CallDetailDialog } from './CallDetailDialog'

const ALL = '__all'
type FilterValue = ModelUsageFeature | typeof ALL

const STATUS_ICON = {
  ok: { icon: CircleCheck, className: 'text-ok' },
  error: { icon: CircleX, className: 'text-danger' },
  aborted: { icon: CircleSlash, className: 'text-fg-3' },
} as const

interface LogState {
  items: ModelCallRecord[]
  hasMore: boolean
  loading: boolean
  error?: string
}

export function CallLogSection({ version, onCleared }: { version: number; onCleared: () => void }) {
  const t = useT()
  const recordContent = useConfig((c) => c.ai.callLog.recordContent)
  const [filter, setFilter] = useState<FilterValue>(ALL)
  const [log, setLog] = useState<LogState>({ items: [], hasMore: false, loading: true })
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const epoch = useRef(0)
  const feature = filter === ALL ? undefined : filter

  const load = useCallback(
    async (mode: 'reset' | 'more', items: readonly ModelCallRecord[] = []) => {
      const run = ++epoch.current
      setLog((s) => ({ ...s, loading: true, error: undefined }))
      try {
        const page = await invoke('models:listCalls', {
          limit: USAGE_PAGE_SIZE,
          before: mode === 'more' ? nextCursor(items) : undefined,
          feature,
        })
        if (run !== epoch.current) return
        setLog({
          items: mode === 'more' ? appendCalls(items, page.items) : page.items,
          hasMore: page.hasMore,
          loading: false,
        })
      } catch (e) {
        if (run === epoch.current) setLog((s) => ({ ...s, loading: false, error: errorMessage(e) }))
      }
    },
    [feature],
  )

  useEffect(() => {
    void load('reset')
  }, [load, version])

  // A new call goes on top of the list while the newest page is shown (and matches the filter).
  useBridgeEvent('models:callRecorded', (call) => {
    if (feature && call.feature !== feature) return
    setLog((s) => (s.items.some((c) => c.id === call.id) ? s : { ...s, items: [call, ...s.items] }))
  })

  const clear = async () => {
    try {
      await invoke('models:clearCalls', undefined)
      toast.success(t('settings.usage.calls.clear.done'))
      onCleared()
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    }
  }

  const filterOptions = [
    { value: ALL as FilterValue, label: t('settings.usage.calls.filterAll') },
    ...MODEL_USAGE_FEATURES.map((f) => ({ value: f, label: t(`settings.usage.features.${f}`) })),
  ]

  return (
    <Section
      id="usage.calls"
      title={t('settings.usage.sections.calls')}
      actions={
        <Select<FilterValue>
          aria-label={t('settings.usage.calls.filterLabel')}
          options={filterOptions}
          value={filter}
          onValueChange={setFilter}
          align="end"
        />
      }
    >
      <Card variant="rows">
        <SRow
          id="usage.recordContent"
          title={t('settings.usage.calls.recordContent.title')}
          description={t('settings.usage.calls.recordContent.description')}
          help={t('settings.usage.calls.recordContent.help')}
        >
          <Toggle
            label={t('settings.usage.calls.recordContent.title')}
            checked={recordContent === true}
            onCheckedChange={(on) => void saveConfig({ ai: { callLog: { recordContent: on } } })}
          />
        </SRow>
      </Card>
      {log.error && log.items.length === 0 ? (
        <EmptyState
          bordered
          compact
          variant="error"
          title={t('settings.usage.calls.loadFailed')}
          description={log.error}
          action={{ label: t('common.retry'), onClick: () => void load('reset') }}
        />
      ) : log.loading && log.items.length === 0 ? (
        <EmptyState bordered compact variant="loading" title={t('common.loading')} />
      ) : log.items.length === 0 ? (
        <EmptyState
          bordered
          compact
          variant={feature ? 'no-results' : 'empty'}
          title={feature ? t('settings.usage.calls.noResults.title') : t('settings.usage.calls.empty.title')}
          description={
            feature ? t('settings.usage.calls.noResults.description') : t('settings.usage.calls.empty.description')
          }
        />
      ) : (
        <Card variant="rows">
          {log.items.map((call) => (
            <CallRow key={call.id} call={call} onOpen={() => setOpenId(call.id)} />
          ))}
          {log.hasMore ? (
            <div className="flex justify-center px-4 py-2">
              <Button variant="ghost" size="sm" loading={log.loading} onClick={() => void load('more', log.items)}>
                {t('settings.usage.calls.loadMore')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
      {log.items.length > 0 ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmClear(true)}>
            {t('settings.usage.calls.clear.button')}
          </Button>
        </div>
      ) : null}
      <CallDetailDialog id={openId} onClose={() => setOpenId(null)} />
      <DangerDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('settings.usage.calls.clear.title')}
        description={t('settings.usage.calls.clear.description')}
        confirmLabel={t('settings.usage.calls.clear.confirm')}
        onConfirm={async () => {
          setConfirmClear(false)
          await clear()
        }}
      />
    </Section>
  )
}

function CallRow({ call, onOpen }: { call: ModelCallRecord; onOpen: () => void }) {
  const t = useT()
  const status = STATUS_ICON[call.status]
  const StatusIcon = status.icon
  const featureLabel = t(`settings.usage.features.${call.feature}`)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('settings.usage.calls.open', { feature: featureLabel, model: call.modelId })}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-hover-5 active:bg-hover-7"
    >
      <StatusIcon
        size={14}
        strokeWidth={ICON_STROKE}
        className={cn('shrink-0', status.className)}
        aria-label={t(`settings.usage.calls.status.${call.status}`)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-body text-fg">{featureLabel}</span>
          {call.local ? <Badge tone="ok">{t('settings.usage.calls.local')}</Badge> : null}
        </div>
        <span className="min-w-0 truncate font-mono text-caption text-fg-3">{call.modelId}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-caption text-fg-3">
        <span>{formatDateTime(call.at)}</span>
        <span>
          {call.status === 'error'
            ? [call.httpStatus ? `HTTP ${call.httpStatus}` : undefined, call.errorCode].filter(Boolean).join(' · ')
            : t('settings.usage.calls.tokens', {
                input: formatTokens(call.inputTokens),
                output: formatTokens(call.outputTokens),
              })}
          {' · '}
          {t('settings.usage.calls.seconds', { s: formatSeconds(call.latencyMs) })}
        </span>
      </div>
    </button>
  )
}
