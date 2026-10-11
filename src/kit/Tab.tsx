import { X } from 'lucide-react'
import { forwardRef, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'

export interface TabProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onSelect'> {
  icon?: IconComponent
  label: string
  active?: boolean
  /** Pinned tabs sit first and hide the ×. */
  pinned?: boolean
  /** Unsaved changes: shows a dot where the × would be. */
  dirty?: boolean
  /** A status dot after the label (e.g. finished unseen = accent, failed = danger); `label` is read out. */
  indicator?: { tone: 'accent' | 'danger'; label: string }
  onSelect?: () => void
  onClose?: () => void
  /** Ground of the active tab — must match the content below it (workspace: content; Agent panel: panel). */
  activeBg?: 'content' | 'panel'
}

/**
 * Tab — h40, icon 14, label 12.5 (CLAUDE.md §3). Active = same ground as its content + top r8 + full-strength text
 * and icon (no accent: a tab strip on screen at all times must not carry a standing blue mark);
 * inactive = weak text; × appears on hover / active; middle-click closes. Wrap in ContextMenuTrigger for the tab menu.
 */
export const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  {
    icon: Icon,
    label,
    active = false,
    pinned = false,
    dirty = false,
    indicator,
    onSelect,
    onClose,
    activeBg = 'content',
    className,
    onKeyDown,
    onAuxClick,
    ...rest
  },
  ref,
) {
  const t = useT()
  const closable = Boolean(onClose) && !pinned
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.target !== e.currentTarget) return
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const list = e.currentTarget.closest('[role="tablist"]')
      const tabs = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []).filter(
        (tab) => tab.closest('[role="tablist"]') === list && tab.getAttribute('aria-disabled') !== 'true',
      )
      const index = tabs.indexOf(e.currentTarget)
      if (index < 0) return
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      e.preventDefault()
      tabs[next]?.focus()
      tabs[next]?.click()
      return
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault()
      onSelect?.()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (closable) {
        e.preventDefault()
        onClose?.()
      }
    }
  }
  const handleAux = (e: MouseEvent<HTMLDivElement>) => {
    onAuxClick?.(e)
    if (e.button === 1 && closable) {
      e.preventDefault()
      onClose?.()
    }
  }
  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      title={label}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onAuxClick={handleAux}
      className={cn(
        'group relative flex h-10 max-w-[200px] min-w-0 shrink-0 cursor-default select-none items-center gap-1.5 pl-3 text-tab outline-none',
        closable || dirty ? 'pr-1.5' : 'pr-3',
        active
          ? cn('rounded-t-item text-fg', activeBg === 'panel' ? 'bg-panel' : 'bg-content')
          : 'text-fg-3 hover:bg-hover-5 hover:text-fg-2 active:bg-hover-7',
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={ICON_SIZE.tab} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {indicator ? (
        <span
          role="img"
          aria-label={indicator.label}
          title={indicator.label}
          className={cn('size-1.5 shrink-0 rounded-chip', indicator.tone === 'danger' ? 'bg-danger' : 'bg-accent')}
        />
      ) : null}
      {closable || dirty ? (
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          {dirty ? (
            <span
              aria-label={t('kit.tab.unsaved')}
              className={cn(
                'size-1.5 rounded-chip bg-accent',
                closable && 'group-hover:hidden group-focus-visible:hidden',
              )}
            />
          ) : null}
          {closable ? (
            <button
              type="button"
              aria-label={t('kit.tab.close', { label })}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onClose?.()
              }}
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-control text-fg-3 hover:bg-hover-7 hover:text-fg active:bg-(--fill-13)',
                dirty
                  ? 'hidden group-hover:inline-flex group-focus-visible:inline-flex'
                  : active
                    ? 'inline-flex'
                    : 'invisible group-hover:visible group-focus-visible:visible',
              )}
            >
              <X size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
})
