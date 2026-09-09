/**
 * 模型厂商 rail (Figma 164:4211 left column): one row per vendor preset, then hand-configured endpoints,
 * then 「+ 自定义」. Status dot = providerStatus (green connected, red last test failed).
 */
import { Plus } from 'lucide-react'
import type { ProviderConfig } from '@aiwc/protocol'
import { Badge, ICON_SIZE, ICON_STROKE, cn } from '@/kit'
import { customProviders, providerForVendor, providerStatus, type ProviderStatus } from '../../aiModel'
import { vendorIconFor } from '../../vendorIcons'
import { VENDORS } from '../../vendors'

/** Rail selection: a vendor preset id, a custom provider id (`custom:<id>`), or the 「新建自定义」 sheet. */
export type RailSelection = { kind: 'vendor'; id: string } | { kind: 'custom'; id: string } | { kind: 'new-custom' }

export const railKey = (s: RailSelection): string => (s.kind === 'new-custom' ? 'new-custom' : `${s.kind}:${s.id}`)

export interface ProviderRailProps {
  providers: readonly ProviderConfig[]
  selection: RailSelection
  onSelect: (s: RailSelection) => void
}

const DOT_TONE: Partial<Record<ProviderStatus, 'ok' | 'danger'>> = { ready: 'ok', ok: 'ok', error: 'danger' }

function RailItem({ icon: Icon, label, status, selected, onClick, mono = false }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>; label: string; status?: ProviderStatus; selected: boolean; onClick: () => void; mono?: boolean }) {
  const tone = status ? DOT_TONE[status] : undefined
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 rounded-control px-2 text-left text-body outline-none @min-[560px]:w-full',
        'transition-colors duration-(--dur-fast) hover:bg-hover-5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70',
        selected ? 'bg-accent-12 text-fg hover:bg-accent-12' : 'text-fg-2',
      )}
    >
      <Icon size={ICON_SIZE.tab} strokeWidth={ICON_STROKE} aria-hidden className={cn('shrink-0', selected ? 'text-fg' : 'text-fg-3')} />
      <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono text-caption')}>{label}</span>
      {tone ? <Badge dot tone={tone} aria-label={tone === 'ok' ? '已接入' : '连接失败'} /> : null}
    </button>
  )
}

export function ProviderRail({ providers, selection, onSelect }: ProviderRailProps) {
  const customs = customProviders(providers)
  return (
    // Narrow cards (settings column under ~560px) lay the rail out as a horizontal strip above the panel;
    // the Figma two-column form kicks in once the card is wide enough (Tailwind container query).
    <div
      role="tablist"
      aria-label="模型厂商"
      aria-orientation="vertical"
      className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line-6 p-2 @min-[560px]:w-[168px] @min-[560px]:flex-col @min-[560px]:overflow-visible @min-[560px]:border-b-0 @min-[560px]:border-r"
    >
      <div className="hidden px-2 pb-1.5 pt-1 text-note text-fg-3 @min-[560px]:block">模型厂商</div>
      {VENDORS.map((v) => (
        <RailItem key={v.id} icon={vendorIconFor(v.id)} label={v.label} status={providerStatus(providerForVendor(providers, v.id))} selected={selection.kind === 'vendor' && selection.id === v.id} onClick={() => onSelect({ kind: 'vendor', id: v.id })} />
      ))}
      {customs.length > 0 ? <div className="hidden px-2 pb-1 pt-2 text-note text-fg-3 @min-[560px]:block">自定义接口</div> : null}
      {customs.map((p) => (
        <RailItem key={p.id} icon={vendorIconFor(undefined)} label={p.label} status={providerStatus(p)} selected={selection.kind === 'custom' && selection.id === p.id} onClick={() => onSelect({ kind: 'custom', id: p.id })} />
      ))}
      <RailItem icon={Plus} label="自定义" selected={selection.kind === 'new-custom'} onClick={() => onSelect({ kind: 'new-custom' })} />
    </div>
  )
}
