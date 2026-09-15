/**
 * Permission mode Select — Ask / Bypass / Autopilot with a one-line description each, and an optional
 * 权限规则… footer (Figma 150:709). Used by the Agent composer (thread-level) and the scheduled-task
 * editor (task-level), so it lives in the kit.
 *
 * Reads never confirm in any mode. Ask stops before writing to this machine; Bypass lets writes
 * through; Autopilot also lets outward sends (WeChat messages, pushes to office platforms) through.
 * Destructive operations confirm in every mode (CLAUDE.md §4.4).
 */
import { Rocket, Settings, ShieldCheck, Zap } from 'lucide-react'
import type { PermissionMode } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import type { IconComponent } from './icon'
import { Select, type SelectOption } from './Select'

interface PermissionModeMeta {
  value: PermissionMode
  label: MessageKey
  /** Trigger text: the mode's name is a proper noun, shown the same in every language. */
  short: string
  description: MessageKey
  icon: IconComponent
}

const PERMISSION_MODES: readonly PermissionModeMeta[] = [
  {
    value: 'ask',
    label: 'kit.permission.ask.label',
    short: 'Ask',
    description: 'kit.permission.ask.description',
    icon: ShieldCheck,
  },
  {
    value: 'bypass',
    label: 'kit.permission.bypass.label',
    short: 'Bypass',
    description: 'kit.permission.bypass.description',
    icon: Zap,
  },
  {
    value: 'autopilot',
    label: 'kit.permission.autopilot.label',
    short: 'Autopilot',
    description: 'kit.permission.autopilot.description',
    icon: Rocket,
  },
]

/** The mode's display name (`Autopilot`) for copy such as 改为 {mode} 并重跑. */
export function permissionModeName(mode: PermissionMode): string {
  return PERMISSION_MODES.find((m) => m.value === mode)?.short ?? mode
}

/** Compact trigger look shared by the toolbar selects: borderless chip, h24. */
export const TOOLBAR_SELECT_CLASS =
  'h-6 max-w-[150px] border-transparent bg-transparent pl-1.5 pr-1 text-caption hover:bg-line-8 data-[state=open]:border-transparent data-[state=open]:bg-line-8'

export interface PermissionSelectProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
  /** Shown as the footer (权限规则…) when given; the caller decides where that leads. */
  onOpenRules?: () => void
}

export function PermissionSelect({ value, onChange, disabled, onOpenRules }: PermissionSelectProps) {
  const t = useT()
  const options: ReadonlyArray<SelectOption<PermissionMode>> = PERMISSION_MODES.map((m) => ({
    value: m.value,
    label: t(m.label),
    description: t(m.description),
    icon: m.icon,
  }))
  return (
    <Select<PermissionMode>
      aria-label={t('kit.permission.label')}
      options={options}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      side="top"
      className={TOOLBAR_SELECT_CLASS}
      contentClassName="w-[320px]"
      renderValue={(o) => PERMISSION_MODES.find((m) => m.value === o?.value)?.short ?? 'Ask'}
      footer={
        onOpenRules
          ? {
              label: t('kit.permission.rules'),
              description: t('kit.permission.rulesDescription'),
              icon: Settings,
              onSelect: onOpenRules,
            }
          : undefined
      }
    />
  )
}
