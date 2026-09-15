/**
 * Model Select — configured models (设置 › AI 接入) with provider · context window · reasoning depth
 * description, a 本地 badge for models that never leave the machine, search, and an optional
 * 管理模型… footer (Figma 150:752). Shared by the Agent composer and the scheduled-task editor.
 */
import { Cpu, Settings } from 'lucide-react'
import { useMemo } from 'react'
import type { InvokeRes, ModelSelection, ReasoningEffort } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Badge } from './Badge'
import { formatTokens } from './format'
import { TOOLBAR_SELECT_CLASS } from './PermissionSelect'
import { Select, type SelectOption } from './Select'
import { vendorIconFor } from './vendorIcons'

/** One configured model as `agent:listModels` reports it. */
export type ModelOption = InvokeRes<'agent:listModels'>[number]

export interface ModelSelectProps {
  models: ModelOption[]
  value?: ModelSelection
  onChange: (model: ModelSelection) => void
  disabled?: boolean
  /** Shown as the footer (管理模型…) when given; the caller decides where that leads. */
  onManage?: () => void
}

const EFFORT_KEY: Record<ReasoningEffort, MessageKey> = {
  off: 'kit.model.effort.off',
  minimal: 'kit.model.effort.minimal',
  low: 'kit.model.effort.low',
  medium: 'kit.model.effort.medium',
  high: 'kit.model.effort.high',
  xhigh: 'kit.model.effort.xhigh',
  max: 'kit.model.effort.max',
}

const key = (m: ModelSelection) => `${m.providerId}::${m.modelId}`

export function modelLabelFor(models: ModelOption[], sel?: ModelSelection): string | undefined {
  if (!sel) return undefined
  return models.find((m) => m.providerId === sel.providerId && m.modelId === sel.modelId)?.label ?? sel.modelId
}

export function ModelSelect({ models, value, onChange, disabled, onManage }: ModelSelectProps) {
  const t = useT()
  const options = useMemo<SelectOption<string>[]>(
    () =>
      models.map((m) => {
        const effort = m.reasoningEffort && m.reasoningEffort !== 'off' ? t(EFFORT_KEY[m.reasoningEffort]) : undefined
        return {
          value: key(m),
          label: m.label,
          icon: m.vendor ? vendorIconFor(m.vendor) : Cpu,
          description: [
            m.local ? t('kit.model.local') : m.providerLabel || m.providerId,
            t('kit.model.contextWindow', { tokens: formatTokens(m.contextWindow) }),
            effort ? t('kit.model.reasoning', { effort }) : undefined,
            m.supportsTools ? undefined : t('kit.model.noTools'),
          ]
            .filter(Boolean)
            .join(' · '),
          badge: m.local ? <Badge tone="ok">{t('kit.model.localBadge')}</Badge> : undefined,
        }
      }),
    [models, t],
  )
  const current = value ? key(value) : undefined
  const known = current !== undefined && options.some((o) => o.value === current)
  return (
    <Select<string>
      aria-label={t('kit.model.label')}
      options={
        known || !value
          ? options
          : [
              ...options,
              {
                value: current as string,
                label: value?.modelId ?? '',
                description: t('kit.model.notFound'),
                icon: Cpu,
              },
            ]
      }
      value={current ?? null}
      onValueChange={(v) => {
        const [providerId, modelId] = v.split('::')
        if (providerId && modelId) onChange({ providerId, modelId })
      }}
      placeholder={models.length ? t('kit.model.default') : t('kit.model.notConfigured')}
      searchable={models.length > 6}
      searchPlaceholder={t('kit.model.searchPlaceholder')}
      emptyText={t('kit.model.noMatches')}
      disabled={disabled}
      side="top"
      align="end"
      className={TOOLBAR_SELECT_CLASS}
      contentClassName="w-[300px]"
      footer={
        onManage
          ? {
              label: t('kit.model.manage'),
              description: t('kit.model.manageDescription'),
              icon: Settings,
              onSelect: onManage,
            }
          : undefined
      }
    />
  )
}
