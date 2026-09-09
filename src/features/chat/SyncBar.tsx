/**
 * Sync bar (DESIGN-SPEC §1.2 ②): state machine 已同步 → 同步中 → 失败 on the left, the two per-tab filters
 * (date range, senders) on the right. Figma 119:471 — h34, panel ground, 1px line below.
 */
import { CircleAlert, RefreshCw } from 'lucide-react'
import { Button, ProgressBar, Spinner, Tooltip, cn } from '@/kit'
import { DateRangeFilter } from './DateRangeFilter'
import { SenderFilter, type SenderOption } from './SenderFilter'
import type { ChatFilters } from './filters'
import type { SyncView } from './syncModel'

export interface SyncBarProps {
  view: SyncView
  filters: ChatFilters
  onFiltersChange(next: ChatFilters): void
  senders: SenderOption[]
  sendersLoading?: boolean
  onSync(): void
  onCancelSync?(): void
}

export function SyncBar({ view, filters, onFiltersChange, senders, sendersLoading, onSync, onCancelSync }: SyncBarProps) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line-6 bg-panel px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-caption">
        {view.phase === 'syncing' ? (
          <>
            <Spinner size={12} />
            <span className="min-w-0 truncate text-fg-2">{view.text}</span>
            {view.progress !== undefined ? <ProgressBar value={view.progress} className="w-[120px]" label="同步进度" /> : null}
            {onCancelSync ? (
              <Button variant="link" size="sm" onClick={onCancelSync} className="text-fg-3 hover:text-fg">
                取消
              </Button>
            ) : null}
          </>
        ) : view.phase === 'error' ? (
          <>
            <CircleAlert size={12} strokeWidth={1.75} aria-hidden className="shrink-0 text-danger" />
            <span className="min-w-0 truncate text-danger" title={view.detail}>
              {view.text}
              {view.detail ? ` · ${view.detail}` : ''}
            </span>
            <Button variant="link" size="sm" icon={RefreshCw} onClick={onSync}>
              重试
            </Button>
          </>
        ) : (
          <Tooltip content={view.detail ?? '点击立即同步'} side="bottom" align="start">
            <button
              type="button"
              onClick={onSync}
              className={cn('flex min-w-0 items-center gap-2 rounded-control px-1 py-0.5 text-left outline-none hover:bg-hover-5 focus-visible:ring-2 focus-visible:ring-accent/70')}
            >
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-chip', view.phase === 'synced' ? 'bg-ok' : 'bg-fg-3')} />
              <span className="min-w-0 truncate text-fg-2">{view.text}</span>
            </button>
          </Tooltip>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DateRangeFilter range={filters.range} onChange={(range) => onFiltersChange({ ...filters, range })} />
        <span aria-hidden className="h-4 w-px bg-line-8" />
        <SenderFilter options={senders} loading={sendersLoading} value={filters.senderIds} onChange={(senderIds) => onFiltersChange({ ...filters, senderIds })} />
      </div>
    </div>
  )
}
