/**
 * Model Select — configured models (设置 › AI 接入) with provider · context window description, a
 * 本地 badge for models that never leave the machine, search, and a 管理模型… footer (Figma 150:752).
 * Switching only affects the current thread.
 */
import { Cpu, Settings } from 'lucide-react'
import { useMemo } from 'react'
import type { ModelSelection } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { Badge, Select, type SelectOption } from '@/kit'
import { effortLabel } from '@/features/settings/aiModel'
import { vendorIconFor } from '@/features/settings/vendorIcons'
import type { ModelOption } from '../agentStore'
import { formatTokens } from '../model'
import { TOOLBAR_SELECT_CLASS } from './PermissionSelect'

export interface ModelSelectProps {
  models: ModelOption[]
  value?: ModelSelection
  onChange: (model: ModelSelection) => void
  disabled?: boolean
}

const key = (m: ModelSelection) => `${m.providerId}::${m.modelId}`

export function modelLabelFor(models: ModelOption[], sel?: ModelSelection): string | undefined {
  if (!sel) return undefined
  return models.find((m) => m.providerId === sel.providerId && m.modelId === sel.modelId)?.label ?? sel.modelId
}

export function ModelSelect({ models, value, onChange, disabled }: ModelSelectProps) {
  const options = useMemo<SelectOption<string>[]>(
    () =>
      models.map((m) => {
        const effort = effortLabel(m.reasoningEffort)
        return {
          value: key(m),
          label: m.label,
          icon: m.vendor ? vendorIconFor(m.vendor) : Cpu,
          description: [m.local ? '本地运行，数据不出本机' : m.providerLabel || m.providerId, `${formatTokens(m.contextWindow)} 上下文`, effort ? `推理 ${effort}` : undefined, m.supportsTools ? undefined : '不支持工具调用'].filter(Boolean).join(' · '),
          badge: m.local ? <Badge tone="ok">本地</Badge> : undefined,
        }
      }),
    [models],
  )
  const current = value ? key(value) : undefined
  const known = current !== undefined && options.some((o) => o.value === current)
  return (
    <Select<string>
      aria-label="模型"
      options={known || !value ? options : [...options, { value: current as string, label: value?.modelId ?? '', description: '未在设置中找到该模型', icon: Cpu }]}
      value={current ?? null}
      onValueChange={(v) => {
        const [providerId, modelId] = v.split('::')
        if (providerId && modelId) onChange({ providerId, modelId })
      }}
      placeholder={models.length ? '默认模型' : '未配置模型'}
      searchable={models.length > 6}
      searchPlaceholder="搜索模型…"
      emptyText="没有匹配的模型"
      disabled={disabled}
      side="top"
      align="end"
      className={TOOLBAR_SELECT_CLASS}
      contentClassName="w-[300px]"
      footer={{ label: '管理模型…', description: '设置 › AI 接入', icon: Settings, onSelect: () => runCommand('tab.openSettings', { page: 'ai' }) }}
    />
  )
}
