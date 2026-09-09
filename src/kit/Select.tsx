import { Check, ChevronUp, ChevronsUpDown, Search } from 'lucide-react'
import { Popover as RadixPopover } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { Divider } from './Divider'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** One-line explanation shown under the label (11px weak). */
  description?: string
  disabled?: boolean
  /** Right-aligned Badge etc. */
  badge?: ReactNode
  icon?: IconComponent
  leading?: ReactNode
}

export interface SelectFooterAction {
  label: string
  description?: string
  icon?: IconComponent
  onSelect: () => void
}

export interface SelectProps<T extends string = string> {
  options: ReadonlyArray<SelectOption<T>>
  value?: T | null
  onValueChange?: (value: T) => void
  placeholder?: string
  /** Adds a search field at the top of the list. */
  searchable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  /** Separated last item, e.g. 「管理…／跳转到设置」. */
  footer?: SelectFooterAction
  /** Trigger height: default = 28 (Figma), lg = 32 to sit next to Inputs. */
  size?: 'default' | 'lg'
  /** Stretch trigger to the container width. */
  fullWidth?: boolean
  align?: 'start' | 'end'
  side?: 'top' | 'bottom'
  id?: string
  'aria-label'?: string
  className?: string
  contentClassName?: string
  /** Custom trigger text (defaults to the selected option's label). */
  renderValue?: (option: SelectOption<T> | undefined) => ReactNode
  /** Controlled open state (gallery / tests). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type Row<T extends string> = { kind: 'option'; option: SelectOption<T> } | { kind: 'footer'; action: SelectFooterAction }

/**
 * Select — pick one value from a few (CLAUDE.md §4.3). Figma 154:791 (trigger) + 154:1063 (list).
 * Trigger h28 r6 fg 5% ground; open = accent border + chevron up; list = overlay ground, r8, items 30 / 42 with
 * description, check mark on the left, hover fg 7%, optional search and a separated "manage…" footer.
 * Built on Radix Popover with an ARIA listbox so search + descriptions + footer all work.
 */
export function Select<T extends string = string>({
  options,
  value,
  onValueChange,
  placeholder = '请选择',
  searchable = false,
  searchPlaceholder = '搜索…',
  emptyText = '没有匹配的选项',
  disabled = false,
  footer,
  size = 'default',
  fullWidth = false,
  align = 'start',
  side = 'bottom',
  id,
  className,
  contentClassName,
  renderValue,
  open: openProp,
  onOpenChange,
  ...aria
}: SelectProps<T>) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  const rows = useMemo<Row<T>[]>(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options
    const out: Row<T>[] = visible.map((option) => ({ kind: 'option', option }))
    if (footer) out.push({ kind: 'footer', action: footer })
    return out
  }, [options, query, footer])

  const isEnabled = (row: Row<T> | undefined) => !!row && (row.kind === 'footer' || !row.option.disabled)

  // Reset state when opening: highlight the selected option.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const idx = rows.findIndex((r) => r.kind === 'option' && r.option.value === value)
    setActive(idx >= 0 ? idx : rows.findIndex(isEnabled))
  }, [open])

  useEffect(() => {
    if (!open) return
    const first = rows.findIndex(isEnabled)
    setActive((a) => (isEnabled(rows[a]) ? a : first))
  }, [rows])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const commit = (row: Row<T> | undefined) => {
    if (!isEnabled(row) || !row) return
    if (row.kind === 'footer') row.action.onSelect()
    else onValueChange?.(row.option.value)
    setOpen(false)
  }

  const step = (dir: 1 | -1) => {
    if (rows.length === 0) return
    let i = active
    for (let n = 0; n < rows.length; n++) {
      i = (i + dir + rows.length) % rows.length
      if (isEnabled(rows[i])) {
        setActive(i)
        return
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        step(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(rows.findIndex(isEnabled))
        break
      case 'End': {
        e.preventDefault()
        const last = [...rows].map((r, i) => (isEnabled(r) ? i : -1)).filter((i) => i >= 0).pop()
        if (last !== undefined) setActive(last)
        break
      }
      case 'Enter':
        e.preventDefault()
        commit(rows[active])
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (!searchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const k = e.key.toLowerCase()
          const idx = rows.findIndex((r) => r.kind === 'option' && !r.option.disabled && r.option.label.toLowerCase().startsWith(k))
          if (idx >= 0) setActive(idx)
        }
    }
  }

  const triggerText = renderValue ? renderValue(selected) : selected?.label

  return (
    <RadixPopover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)} modal={false}>
      <RadixPopover.Trigger asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={aria['aria-label']}
          disabled={disabled}
          data-state={open ? 'open' : 'closed'}
          data-placeholder={selected ? undefined : ''}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line-8 bg-hover-5 pl-2.5 pr-2 text-caption text-fg',
            'transition-colors duration-(--dur-fast) hover:bg-line-10',
            'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
            'data-[state=open]:border-accent/70 data-[state=open]:hover:bg-hover-5',
            'disabled:pointer-events-none disabled:opacity-45',
            'data-[placeholder]:text-fg-3',
            size === 'lg' ? 'h-8' : 'h-7',
            fullWidth && 'flex w-full',
            className,
          )}
        >
          {selected?.icon ? <selected.icon size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" /> : null}
          <span className={cn('min-w-0 truncate text-left', fullWidth && 'flex-1')}>{triggerText ?? placeholder}</span>
          {open ? (
            <ChevronUp size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="ml-auto shrink-0 text-fg-3" />
          ) : (
            <ChevronsUpDown size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="ml-auto shrink-0 text-fg-3" />
          )}
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            // Only pull focus into the list when the user opened it from the trigger (not when forced open).
            if (document.activeElement === triggerRef.current) (searchable ? searchRef.current : listRef.current)?.focus()
          }}
          className={cn(
            'kit-menu z-50 flex max-h-(--radix-popover-content-available-height) w-max min-w-[max(200px,var(--radix-popover-trigger-width))] max-w-[360px]',
            'flex-col rounded-item border border-line-10 bg-overlay p-1.5 shadow-overlay outline-none',
            contentClassName,
          )}
        >
          {searchable ? (
            <div className="mb-1 flex h-7 items-center gap-1.5 rounded-control border border-line-8 bg-content px-2 focus-within:border-accent/80">
              <Search size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                className="min-w-0 flex-1 bg-transparent text-caption text-fg caret-accent outline-none placeholder:text-fg-3"
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            onKeyDown={searchable ? undefined : handleKeyDown}
            className="flex min-h-0 flex-col gap-px overflow-y-auto outline-none"
          >
            {rows.length === 0 || (rows.length === 1 && rows[0]?.kind === 'footer' && options.length > 0 && query) ? (
              <div className="px-2 py-2 text-caption text-fg-3">{emptyText}</div>
            ) : null}
            {rows.map((row, i) => {
              if (row.kind === 'footer') {
                const Icon = row.action.icon
                return (
                  <div key="__footer" className="contents">
                    {i > 0 ? <Divider strength={8} className="my-1" /> : null}
                    <div
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={false}
                      data-index={i}
                      data-highlighted={active === i || undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(row)}
                      className={itemClass(Boolean(row.action.description))}
                    >
                      <span className="flex size-3 shrink-0 items-center justify-center text-fg-3">
                        {Icon ? <Icon size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden /> : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-tab text-fg">{row.action.label}</span>
                        {row.action.description ? <span className="truncate text-micro text-fg-3">{row.action.description}</span> : null}
                      </span>
                    </div>
                  </div>
                )
              }
              const { option } = row
              const isSelected = option.value === value
              return (
                <div
                  key={option.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-index={i}
                  data-highlighted={active === i || undefined}
                  data-disabled={option.disabled || undefined}
                  onMouseEnter={() => !option.disabled && setActive(i)}
                  onClick={() => commit(row)}
                  className={itemClass(Boolean(option.description))}
                >
                  <span className="flex size-3 shrink-0 items-center justify-center text-accent">
                    {isSelected ? <Check size={ICON_SIZE.menuAux} strokeWidth={2} aria-hidden /> : null}
                  </span>
                  {option.leading}
                  {option.icon ? <option.icon size={ICON_SIZE.menu} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" /> : null}
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-tab text-fg">{option.label}</span>
                    {option.description ? <span className="truncate text-micro text-fg-3">{option.description}</span> : null}
                  </span>
                  {option.badge ? <span className="shrink-0">{option.badge}</span> : null}
                </div>
              )
            })}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

function itemClass(withDescription: boolean) {
  return cn(
    'flex shrink-0 cursor-default select-none items-center gap-2 rounded-control px-2 outline-none',
    withDescription ? 'h-[42px]' : 'h-[30px]',
    'data-[highlighted]:bg-hover-7 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  )
}
