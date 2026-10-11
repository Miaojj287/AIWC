/**
 * Reasoning effort select — the composer toolbar's per-thread reasoning depth (ThreadSettings.reasoningEffort). Lists
 * only the levels the chosen model supports (modelCapabilities), plus 默认 = the model's own setting in 设置 › AI 接入.
 * The caller hides it for models without reasoning control.
 */
import { Brain } from 'lucide-react'
import { useMemo } from 'react'
import type { ReasoningEffort } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { ICON_STROKE } from './icon'
import { TOOLBAR_SELECT_CLASS } from './PermissionSelect'
import { Select, type SelectOption } from './Select'

const DEFAULT = 'default'

const LEVEL_KEY: Record<ReasoningEffort, MessageKey> = {
  off: 'kit.model.effort.off',
  minimal: 'kit.model.effort.minimal',
  low: 'kit.model.effort.low',
  medium: 'kit.model.effort.medium',
  high: 'kit.model.effort.high',
  xhigh: 'kit.model.effort.xhigh',
  max: 'kit.model.effort.max',
}

export interface ReasoningEffortSelectProps {
  /** Levels the model supports, lowest first. */
  levels: readonly ReasoningEffort[]
  /** The thread's choice; null / undefined (or a level the model lacks) = 默认. */
  value?: ReasoningEffort | null
  /** The model's own setting, named in the 默认 option. */
  modelDefault?: ReasoningEffort
  onChange: (value: ReasoningEffort | null) => void
  disabled?: boolean
}

export function ReasoningEffortSelect({ levels, value, modelDefault, onChange, disabled }: ReasoningEffortSelectProps) {
  const t = useT()
  const options = useMemo<SelectOption<ReasoningEffort | typeof DEFAULT>[]>(
    () => [
      {
        value: DEFAULT,
        label:
          modelDefault && levels.includes(modelDefault)
            ? t('kit.effortSelect.defaultWith', { effort: t(LEVEL_KEY[modelDefault]) })
            : t('kit.effortSelect.default'),
        description: t('kit.effortSelect.defaultDescription'),
      },
      ...levels.map((level) => ({
        value: level,
        label: t(LEVEL_KEY[level]),
        description: t(`kit.effortSelect.description.${level}`),
      })),
    ],
    [levels, modelDefault, t],
  )
  const current = value && levels.includes(value) ? value : DEFAULT
  return (
    <Select<ReasoningEffort | typeof DEFAULT>
      aria-label={t('kit.effortSelect.label')}
      options={options}
      value={current}
      onValueChange={(v) => onChange(v === DEFAULT ? null : v)}
      disabled={disabled}
      side="top"
      align="end"
      className={TOOLBAR_SELECT_CLASS}
      contentClassName="w-[260px]"
      renderValue={(o) => (
        <span className="flex min-w-0 items-center gap-1">
          <Brain size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
          <span className="truncate">{o?.value === DEFAULT || !o ? t('kit.effortSelect.default') : o.label}</span>
        </span>
      )}
    />
  )
}
