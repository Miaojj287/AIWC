/**
 * 未克隆 confirm page (Figma 144:415, board 153:415 ②): avatar 64, title, description, message / span pills,
 * 训练范围 / 使用模型 selects, primary 开始克隆 (+ 先看看样本对话). <300 messages → warning.
 */
import { Bot, Calendar, MessageSquare } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ModelSelection } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, Badge, Button, Card, ICON_STROKE, InlineHint, Select, SettingRow, type SelectOption } from '@/kit'
import { runCommand } from '@/app/commands'
import { formatNumber } from '@/platform/format'
import { useInvoke } from '@/platform/hooks'
import { readStatsOverview } from '@/platform/statsOverview'
import { MIN_RECOMMENDED_MESSAGES, RANGE_OPTIONS, type TrainingRange } from '../cloneView'
import { SampleDialog } from './SampleDialog'

export interface CloneParams {
  range: TrainingRange
  model: ModelSelection | undefined
}

export interface IdleViewProps {
  contactId: string
  name: string
  avatarPath?: string
  messageCount: number | undefined
  params: CloneParams
  onParamsChange: (p: CloneParams) => void
  onStart: () => void
  starting: boolean
}

const modelKey = (m: ModelSelection) => `${m.providerId}::${m.modelId}`

export function IdleView({
  contactId,
  name,
  avatarPath,
  messageCount,
  params,
  onParamsChange,
  onStart,
  starting,
}: IdleViewProps) {
  const t = useT()
  const stats = useInvoke('substrate:stats', { sessionId: contactId, metric: 'overview' }, [contactId])
  const models = useInvoke('agent:listModels', undefined, [])
  const [samplesOpen, setSamplesOpen] = useState(false)

  // The overview is the authority; messageCount (from clone:status / the session index) is the
  // fallback while it loads. Never show 0 as a fact: a 0 here means "not counted yet", and it used
  // to turn a 59,175-message chat into 「只有 0 条消息」 plus a bogus 语料不足 warning.
  const overview = readStatsOverview(stats.data)
  const total =
    overview && overview.total > 0 ? overview.total : messageCount && messageCount > 0 ? messageCount : undefined
  const firstAt = overview && overview.firstAt > 0 ? overview.firstAt : undefined
  const few = total !== undefined && total < MIN_RECOMMENDED_MESSAGES

  const modelOptions: SelectOption[] = (models.data ?? []).map((m) => ({
    value: modelKey(m),
    label: m.label,
    description: m.local ? t('clone.idle.localModel') : m.providerId,
    badge: m.local ? <Badge tone="ok">{t('clone.idle.local')}</Badge> : undefined,
  }))
  const selectedModel = params.model ? modelKey(params.model) : models.data?.[0] ? modelKey(models.data[0]) : null
  const spanLabel = firstAt
    ? t('clone.idle.since', {
        date: `${new Date(firstAt).getFullYear()}-${String(new Date(firstAt).getMonth() + 1).padStart(2, '0')}`,
      })
    : undefined

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-8">
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-5 text-center">
        <Avatar id={contactId} name={name} src={avatarPath} size={64} className="ring-4 ring-clone/25" />
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-semibold leading-7 text-fg">{t('clone.idle.title', { name })}</h1>
          <p className="text-body leading-5 text-fg-2">{t('clone.idle.description')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Stat icon={<MessageSquare size={12} strokeWidth={ICON_STROKE} aria-hidden />}>
            {total !== undefined
              ? t('clone.idle.messages', { n: total, count: formatNumber(total) })
              : stats.loading
                ? t('clone.idle.counting')
                : t('clone.idle.messagesUnknown')}
          </Stat>
          {spanLabel ? (
            <Stat icon={<Calendar size={12} strokeWidth={ICON_STROKE} aria-hidden />}>{spanLabel}</Stat>
          ) : null}
        </div>
        <Card variant="rows" className="w-full text-left">
          <SettingRow title={t('clone.idle.range')}>
            <Select<TrainingRange>
              aria-label={t('clone.idle.range')}
              options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label), description: t(o.description) }))}
              value={params.range}
              onValueChange={(range) => onParamsChange({ ...params, range })}
              className="min-w-[150px]"
            />
          </SettingRow>
          <SettingRow title={t('clone.idle.model')}>
            <Select
              aria-label={t('clone.idle.model')}
              options={modelOptions}
              value={selectedModel}
              placeholder={models.loading ? t('clone.idle.modelsLoading') : t('clone.idle.noModelConfigured')}
              disabled={modelOptions.length === 0}
              onValueChange={(v) => {
                const found = (models.data ?? []).find((m) => modelKey(m) === v)
                if (found)
                  onParamsChange({ ...params, model: { providerId: found.providerId, modelId: found.modelId } })
              }}
              footer={{
                label: t('clone.idle.manageModels'),
                description: t('clone.idle.manageModelsPath'),
                onSelect: () => runCommand('tab.openSettings', { page: 'ai' }),
              }}
              className="min-w-[140px]"
            />
          </SettingRow>
        </Card>
        {few ? (
          <InlineHint kind="warning">
            {t('clone.idle.fewMessages', {
              n: total ?? 0,
              count: formatNumber(total ?? 0),
              min: MIN_RECOMMENDED_MESSAGES,
            })}
          </InlineHint>
        ) : null}
        {/* Both hints describe the page as it opens; neither answers an input, so neither interrupts as an alert. */}
        {models.data && models.data.length === 0 ? (
          <InlineHint kind="error" live={false}>
            {t('clone.idle.noModels')}
          </InlineHint>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            icon={Bot}
            onClick={onStart}
            loading={starting}
            disabled={models.data !== undefined && models.data.length === 0}
            disabledReason={t('clone.idle.noModels')}
          >
            {few ? t('clone.idle.cloneAnyway') : t('clone.actions.start')}
          </Button>
          <Button variant="ghost" onClick={() => setSamplesOpen(true)}>
            {t('clone.idle.previewSamples')}
          </Button>
        </div>
      </div>
      <SampleDialog
        open={samplesOpen}
        onOpenChange={setSamplesOpen}
        contactId={contactId}
        name={name}
        onStart={() => {
          setSamplesOpen(false)
          onStart()
        }}
      />
    </div>
  )
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-control border border-line-8 bg-panel px-2.5 font-latin text-caption text-fg-2">
      <span className="text-fg-3">{icon}</span>
      {children}
    </span>
  )
}
