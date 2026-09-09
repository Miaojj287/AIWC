/**
 * Permission mode Select — Ask / Bypass with one-line descriptions and a 权限规则… footer that jumps
 * to settings (Figma 150:709). Thread-level setting (CLAUDE.md §5).
 *
 * Neither mode confirms plain tool calls: reads always run. Ask stops before writing to this machine;
 * Bypass lets writes through too. 对外发送和破坏性操作在两种模式下都必须二次确认（CLAUDE.md §4.4）。
 */
import { Settings, ShieldCheck, Zap } from 'lucide-react'
import type { PermissionMode } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { Select, type IconComponent, type SelectOption } from '@/kit'

export const PERMISSION_MODES: ReadonlyArray<{ value: PermissionMode; label: string; short: string; description: string; icon: IconComponent }> = [
  { value: 'ask', label: 'Ask 模式', short: 'Ask', description: '读取直接执行；写入本机数据前询问', icon: ShieldCheck },
  { value: 'bypass', label: 'Bypass 模式', short: 'Bypass', description: '读取和写入都直接执行，不再询问', icon: Zap },
]

const OPTIONS: ReadonlyArray<SelectOption<PermissionMode>> = PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label, description: m.description, icon: m.icon }))

/** Compact trigger look shared by the toolbar selects: borderless chip, h24. */
export const TOOLBAR_SELECT_CLASS = 'h-6 max-w-[150px] border-transparent bg-transparent pl-1.5 pr-1 text-caption hover:bg-line-8 data-[state=open]:border-transparent data-[state=open]:bg-line-8'

export interface PermissionSelectProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
}

export function PermissionSelect({ value, onChange, disabled }: PermissionSelectProps) {
  return (
    <Select<PermissionMode>
      aria-label="权限模式"
      options={OPTIONS}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      side="top"
      className={TOOLBAR_SELECT_CLASS}
      contentClassName="w-[290px]"
      renderValue={(o) => PERMISSION_MODES.find((m) => m.value === o?.value)?.short ?? 'Ask'}
      footer={{
        label: '权限规则…',
        description: '发送 / 删除等高危操作始终需要确认',
        icon: Settings,
        onSelect: () => runCommand('tab.openSettings', { page: 'ai', highlight: 'permissions' }),
      }}
    />
  )
}
