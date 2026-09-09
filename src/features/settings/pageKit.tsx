/**
 * Settings page building blocks (DESIGN-SPEC §2): page header, section label and the settings row
 * with search-highlight support. Every page is `PageHeader + Section* → Card variant="rows" → SRow*`.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { SettingRow, cn, type SettingRowProps } from '@/kit'

/** Row id (SettingsRow.id from searchIndex) that should flash for ~2 s, or undefined. */
export const HighlightContext = createContext<string | undefined>(undefined)

/**
 * Lets a settings page tell the tab it holds unsaved edits, so leaving (another page, ⌘W, the tab ×)
 * asks first instead of dropping them (交互准则 8 / 9). Pages call `useReportDirty(dirty)`.
 */
export const DirtyContext = createContext<(key: string, dirty: boolean) => void>(() => {})

/** Report this page's unsaved state for as long as it is mounted. */
export function useReportDirty(key: string, dirty: boolean): void {
  const report = useContext(DirtyContext)
  useEffect(() => {
    report(key, dirty)
  }, [report, key, dirty])
  useEffect(() => () => report(key, false), [report, key])
}

export const rowDomId = (id: string): string => `setting-row-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

export function PageHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-title font-medium leading-7 text-fg">{title}</h1>
      {description ? <p className="text-caption text-fg-3">{description}</p> : null}
    </header>
  )
}

export interface SectionProps {
  title: ReactNode
  /** Right-aligned helper (path, actions). */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/** Section label (12 weak) above one or more cards. */
export function Section({ title, aside, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">
        <h2 className="text-caption text-fg-3">{title}</h2>
        {aside ? <div className="ml-auto min-w-0 truncate text-micro text-fg-3">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

export interface SRowProps extends SettingRowProps {
  /** Search-index id (also the `highlight` payload of tab.openSettings). */
  id: string
}

/** SettingRow that can be jumped to and highlighted from the settings search. */
export function SRow({ id, className, ...rest }: SRowProps) {
  const highlight = useContext(HighlightContext)
  const on = highlight === id
  useEffect(() => {
    if (!on) return
    document.getElementById(rowDomId(id))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [on, id])
  return (
    <SettingRow
      id={rowDomId(id)}
      data-setting-row={id}
      data-highlighted={on || undefined}
      className={cn('transition-colors duration-(--dur-base)', on && 'bg-accent-12 ring-1 ring-inset ring-accent/50', className)}
      {...rest}
    />
  )
}

/** Card-shaped placeholder while a page's data loads. */
export function PagePlaceholder({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="加载中" className="flex flex-col gap-2 rounded-card border border-line-6 bg-panel p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <div className="h-2.5 w-28 animate-pulse rounded-chip bg-line-10" />
            <div className="h-2 w-44 animate-pulse rounded-chip bg-line-6" />
          </div>
          <div className="h-6 w-24 animate-pulse rounded-control bg-line-8" />
        </div>
      ))}
    </div>
  )
}
