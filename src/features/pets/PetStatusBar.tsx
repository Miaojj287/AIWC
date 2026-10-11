/**
 * PetStatusBar — the pet's quiet count readout (Codex-style): `! 1 · ⟳ 2 · ✓ 1 · 💬 5` as icons and numbers in a
 * single raised capsule (`row`, beside the perched pet) or a narrow column (`column`, the 40px collapsed strip).
 * Each count names itself in a tooltip; clickable counts open what they count. Nothing renders while all are zero.
 */
import { Check, CircleAlert, CircleX, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn, ICON_STROKE, Spinner, Tooltip } from '@/kit'
import { petStatusSummary, type PetStatusItem, type PetStatusKind } from './petStatus'

export interface PetStatusBarProps {
  items: readonly PetStatusItem[]
  orientation?: 'row' | 'column'
  /** Omitted = a static readout (the settings preview). */
  onSelect?: (item: PetStatusItem) => void
  className?: string
}

const ICON_SIZE = 12

function iconFor(kind: PetStatusKind): ReactNode {
  switch (kind) {
    case 'waiting':
      return <CircleAlert size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden className="text-warn" />
    case 'running':
      return <Spinner size={12} aria-hidden />
    case 'done':
      return <Check size={ICON_SIZE} strokeWidth={2} aria-hidden className="text-ok" />
    case 'failed':
      return <CircleX size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />
    case 'unread':
      return <MessageCircle size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-2" />
  }
}

/** The count's own colour: urgent ones in their semantic ink, the rest in secondary text. */
const COUNT_TONE: Record<PetStatusKind, string> = {
  waiting: 'text-warn-ink',
  running: 'text-fg-2',
  done: 'text-fg-2',
  failed: 'text-danger-ink',
  unread: 'text-fg-2',
}

export function PetStatusBar({ items, orientation = 'row', onSelect, className }: PetStatusBarProps) {
  const t = useT()
  if (items.length === 0) return null
  const column = orientation === 'column'
  return (
    <div
      role="group"
      aria-label={petStatusSummary(items) ?? t('pets.status.group')}
      data-testid="pet-status"
      className={cn(
        'pointer-events-auto flex items-center',
        column
          ? 'flex-col gap-0.5'
          : 'h-6 gap-0.5 rounded-chip border border-line-8 bg-raised px-0.5 text-micro leading-4',
        className,
      )}
    >
      {items.map((item) => {
        const interactive = Boolean(onSelect && item.actionable)
        const body = (
          <>
            <span className="flex size-3 shrink-0 items-center justify-center">{iconFor(item.kind)}</span>
            <span className={cn('tabular-nums', COUNT_TONE[item.kind])}>{item.text}</span>
          </>
        )
        const shape = cn(
          'inline-flex shrink-0 items-center rounded-chip text-micro leading-4 outline-none',
          column ? 'h-5 w-9 justify-center gap-0.5' : 'h-5 gap-1 px-1.5',
        )
        return (
          <Tooltip key={item.kind} content={item.label} side={column ? 'left' : 'top'}>
            {interactive ? (
              <button
                type="button"
                data-kind={item.kind}
                aria-label={item.label}
                onClick={() => onSelect?.(item)}
                className={cn(shape, 'cursor-pointer hover:bg-hover-7 active:bg-(--fill-13)')}
              >
                {body}
              </button>
            ) : (
              <span role="img" data-kind={item.kind} aria-label={item.label} className={shape}>
                {body}
              </span>
            )}
          </Tooltip>
        )
      })}
    </div>
  )
}
