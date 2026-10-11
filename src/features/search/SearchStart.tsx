/**
 * The search tab before a search: what the box does, then 最近搜索 (per viewer, newest first). A row searches again;
 * `···` / right-click also removes it; 清除 empties the list with 撤销 in the Toast.
 */
import { History, Search, TextSearch, X } from 'lucide-react'
import { useId } from 'react'
import { useT } from '@/i18n'
import { Button, EmptyState, ICON_STROKE, ScrollArea, toast, type MenuSpec } from '@/kit'
import { listKeyNav } from '@/platform/listNavigation'
import { MenuRow } from './MenuRow'
import { clearRecentSearches, forgetSearch, restoreRecentSearches, useRecentSearches } from './recentSearches'

export interface SearchStartProps {
  onPick(query: string): void
}

export function SearchStart({ onPick }: SearchStartProps) {
  const t = useT()
  const recent = useRecentSearches((s) => s.items)
  const headingId = useId()

  const clearAll = () => {
    const previous = clearRecentSearches()
    toast.success(t('search.initial.recentCleared'), {
      action: { label: t('search.initial.undo'), onClick: () => restoreRecentSearches(previous) },
    })
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-5 pb-8 pt-2">
        <EmptyState icon={TextSearch} title={t('search.initial.title')} />
        {recent.length > 0 ? (
          <section aria-labelledby={headingId} className="flex flex-col gap-1">
            <div className="flex min-w-0 items-center justify-between gap-2 px-3">
              <h2 id={headingId} className="min-w-0 truncate text-body font-semibold leading-5 text-fg">
                {t('search.initial.recent')}
              </h2>
              <Button variant="link" size="sm" icon={X} onClick={clearAll}>
                {t('search.initial.clearRecent')}
              </Button>
            </div>
            <div className="flex flex-col gap-px" onKeyDown={listKeyNav}>
              {recent.map((query) => (
                <RecentRow key={query} query={query} onPick={onPick} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function RecentRow({ query, onPick }: { query: string; onPick(query: string): void }) {
  const t = useT()
  const menu: MenuSpec = [
    { id: 'search', label: t('search.initial.searchAgain'), icon: Search, onSelect: () => onPick(query) },
    { type: 'separator' },
    { id: 'remove', label: t('search.initial.removeRecent'), icon: X, onSelect: () => forgetSearch(query) },
  ]
  return (
    <MenuRow
      dense
      leading={
        <span className="flex size-9 items-center justify-center rounded-item bg-raised text-fg-2">
          <History size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      }
      title={query}
      onSelect={() => onPick(query)}
      menu={menu}
      moreLabel={t('search.initial.recentActions', { query })}
    />
  )
}
