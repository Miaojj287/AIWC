/**
 * Settings page building blocks (DESIGN-SPEC §2): page header, section label and the settings row
 * with search-highlight support. Every page is `PageHeader + Section* → Card variant="rows" → SRow*`.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { HelpTip, SettingRow, cn, type SettingRowProps } from '@/kit'
import { useT } from '@/i18n'

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
    <header className="flex flex-col gap-2 border-b border-line-6 pb-5">
      <h1 className="text-title font-semibold leading-7 text-fg">{title}</h1>
      {description ? <p className="max-w-[480px] text-body leading-5 text-fg-3">{description}</p> : null}
    </header>
  )
}

/** What the settings search highlights for ~2 s: a fill only, eased in and out — no ring, nothing moves. */
const HIGHLIGHT_CLASS = 'transition-colors duration-(--dur-surface)'

/** Scrolls `id`'s element into view while the search highlights it, and says whether it is highlighted. */
function useSearchTarget(id: string | undefined, block: ScrollLogicalPosition): boolean {
  const highlight = useContext(HighlightContext)
  const on = id !== undefined && highlight === id
  useEffect(() => {
    if (!on || id === undefined) return
    document.getElementById(rowDomId(id))?.scrollIntoView({ block, behavior: 'instant' })
  }, [on, id, block])
  return on
}

export interface SectionProps {
  title: ReactNode
  /** Search-index id when the section itself is a search result (it has no row that repeats its title). */
  id?: string
  /** Explanation behind a ? glyph after the label (data-flow / privacy notes live here, not as standing hints). */
  help?: ReactNode
  /** Right-aligned helper text (a path, a count); one line, truncated. */
  aside?: ReactNode
  /** Right-aligned controls (a Button, an IconButton). Not clipped, so their focus ring stays whole. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/** Section title (13 Semibold) above one or more cards. */
export function Section({ title, id, help, aside, actions, children, className }: SectionProps) {
  const on = useSearchTarget(id, 'start')
  return (
    <section
      id={id === undefined ? undefined : rowDomId(id)}
      data-setting-row={id}
      data-highlighted={on || undefined}
      className={cn('flex scroll-mt-4 flex-col gap-3', className)}
    >
      <div className={cn('flex items-center gap-1.5 rounded-control px-1', HIGHLIGHT_CLASS, on && 'bg-accent-12')}>
        <h2 className="shrink-0 whitespace-nowrap text-body font-semibold text-fg">{title}</h2>
        {help ? <HelpTip content={help} size={12} subject={typeof title === 'string' ? title : undefined} /> : null}
        {aside ? (
          <div
            className="ml-auto min-w-0 truncate pl-3 text-micro text-fg-3"
            title={typeof aside === 'string' ? aside : undefined}
          >
            {aside}
          </div>
        ) : null}
        {actions ? (
          <div className={cn('flex shrink-0 items-center gap-2', aside ? 'pl-1' : 'ml-auto pl-3')}>{actions}</div>
        ) : null}
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
  const on = useSearchTarget(id, 'center')
  return (
    <SettingRow
      id={rowDomId(id)}
      data-setting-row={id}
      data-highlighted={on || undefined}
      className={cn(HIGHLIGHT_CLASS, on && 'bg-accent-12', className)}
      {...rest}
    />
  )
}

/** Card-shaped placeholder while a page's data loads. */
export function PagePlaceholder({ rows = 3 }: { rows?: number }) {
  const t = useT()
  return (
    <div
      role="status"
      aria-label={t('common.loading')}
      className="flex flex-col gap-2 rounded-card border border-line-6 bg-panel p-4"
    >
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
