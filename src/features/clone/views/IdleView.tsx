/**
 * 未克隆 confirm page (Figma 144:415, board 153:415 ②): avatar 64, title, description, stat pills,
 * privacy bar, 训练范围 / 使用模型 selects, primary 开始克隆 (+ 先看看样本对话). <300 messages → warning.
 */
import { Bot, Calendar, CircleAlert, Image, MessageSquare, Mic } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ModelSelection } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, Badge, Button, ICON_STROKE, InlineHint, Select, type SelectOption } from '@/kit'
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
  const voice = overview && overview.voiceCount > 0 ? overview.voiceCount : undefined
  const images = overview && overview.imageCount > 0 ? overview.imageCount : undefined
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
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-8 py-10">
      <div className="flex w-full max-w-[560px] flex-col items-center gap-4 text-center">
        <Avatar id={contactId} name={name} src={avatarPath} size={64} className="ring-4 ring-clone/25" />
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-medium leading-7 text-fg">{t('clone.idle.title', { name })}</h1>
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
          {voice !== undefined ? (
            <Stat icon={<Mic size={12} strokeWidth={ICON_STROKE} aria-hidden />}>
              {t('clone.idle.voice', { n: voice, count: formatNumber(voice) })}
            </Stat>
          ) : null}
          {images !== undefined ? (
            <Stat icon={<Image size={12} strokeWidth={ICON_STROKE} aria-hidden />}>
              {t('clone.idle.images', { n: images, count: formatNumber(images) })}
            </Stat>
          ) : null}
        </div>
        <div className="flex w-full items-start gap-2 rounded-item border border-accent/30 bg-accent/8 px-3 py-2.5 text-left text-caption leading-[18px] text-accent">
          <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          <span>{t('clone.idle.privacy')}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-caption text-fg-2">
            {t('clone.idle.range')}
            <Select<TrainingRange>
              aria-label={t('clone.idle.range')}
              options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label), description: t(o.description) }))}
              value={params.range}
              onValueChange={(range) => onParamsChange({ ...params, range })}
              className="min-w-[150px]"
            />
          </label>
          <label className="flex items-center gap-2 text-caption text-fg-2">
            {t('clone.idle.model')}
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
          </label>
        </div>
        {few ? (
          <InlineHint kind="warning">
            {t('clone.idle.fewMessages', {
              n: total ?? 0,
              count: formatNumber(total ?? 0),
              min: MIN_RECOMMENDED_MESSAGES,
            })}
          </InlineHint>
        ) : null}
        {models.data && models.data.length === 0 ? (
          <InlineHint kind="error">{t('clone.idle.noModels')}</InlineHint>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            icon={Bot}
            onClick={onStart}
            loading={starting}
            disabled={models.data !== undefined && models.data.length === 0}
          >
            {few ? t('clone.idle.cloneAnyway') : t('clone.actions.start')}
          </Button>
          <Button variant="ghost" onClick={() => setSamplesOpen(true)}>
            {t('clone.idle.previewSamples')}
          </Button>
        </div>
        <p className="text-micro text-fg-3">{t('clone.idle.estimate')}</p>
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
