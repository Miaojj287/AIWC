/**
 * Left column of the settings Tab (200px): account block, search with inline results, grouped nav.
 * Figma 125:415 (left) and board 151:415 ① 导航与搜索.
 */
import { BookOpen, Cpu, Info, SlidersHorizontal, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Avatar, ICON_STROKE, ListItem, SearchBox, cn, type IconComponent } from '@/kit'
import { truncateMiddle } from '@/platform/format'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { toMediaUrl } from '@/platform/mediaUrl'
import { NAV_GROUPS, PAGE_META, type SettingsPage } from './model'
import { searchSettings, type SearchHit } from './searchIndex'

const PAGE_ICON: Record<SettingsPage, IconComponent> = {
  general: SlidersHorizontal,
  account: UserRound,
  ai: Cpu,
  memory: BookOpen,
  about: Info,
}

export interface SettingsNavProps {
  page: SettingsPage
  onNavigate: (page: SettingsPage, highlight?: string) => void
  /** Focused by ⌘F when the settings tab is active. */
  searchRef?: RefObject<HTMLInputElement | null>
  shortcutLabel?: string
}

export function SettingsNav({ page, onNavigate, searchRef, shortcutLabel }: SettingsNavProps) {
  const status = useAccountStatus()
  const account = status.data?.account
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const hits = useMemo(() => searchSettings(query), [query])
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (hit: SearchHit) => {
    onNavigate(hit.row.page, hit.row.id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) pick(hit)
    }
  }

  const showResults = open && query.trim().length > 0

  return (
    <nav aria-label="设置导航" className="flex w-[var(--w-settings-nav)] shrink-0 flex-col gap-3 border-r border-line-6 bg-panel px-2.5 py-3">
      <div className="flex items-center gap-2.5 px-1.5">
        {account ? (
          <Avatar id={account.wxid} name={account.nickname ?? account.wxid} src={toMediaUrl(account.avatarPath)} size={28} square />
        ) : (
          <div aria-hidden className="size-7 shrink-0 rounded-control bg-line-8" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium leading-4 text-fg">{account ? account.nickname ?? account.wxid : status.loading ? '读取账号…' : '未连接账号'}</span>
          <span className="truncate font-mono text-micro leading-4 text-fg-3" title={account?.wxid}>
            {account ? `${truncateMiddle(account.wxid, 16)} · 本地` : '在「账号」中配置'}
          </span>
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        <SearchBox
          ref={searchRef}
          size="sm"
          value={query}
          onValueChange={(v) => {
            setQuery(v)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索设置"
          shortcut={shortcutLabel}
          aria-label="搜索设置"
          aria-expanded={showResults}
        />
        {showResults ? (
          <div role="listbox" aria-label="匹配的设置项" className="kit-menu absolute inset-x-0 top-full z-20 mt-1 flex flex-col gap-px rounded-item border border-line-10 bg-overlay p-1.5 shadow-overlay">
            <div className="px-2 pb-1 pt-1 text-micro text-fg-3">{hits.length > 0 ? `${hits.length} 个匹配` : '没有找到相关设置'}</div>
            {hits.length === 0 ? (
              <div className="px-2 pb-1.5 text-note text-fg-3">换个关键词试试，例如「密钥」「模型」「记忆」</div>
            ) : (
              hits.map((hit, i) => (
                <ListItem
                  key={hit.row.id}
                  dense
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  data-hover={i === active || undefined}
                  title={hit.row.title}
                  subtitle={hit.location}
                  onSelect={() => pick(hit)}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  className="min-h-[42px] px-2 py-0.5"
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-micro text-fg-3">{group.label}</div>
            {group.pages.map((p) => {
              const Icon = PAGE_ICON[p]
              const selected = p === page
              return (
                <button
                  key={p}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onNavigate(p)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-item px-2.5 text-left text-body outline-none transition-colors duration-(--dur-fast)',
                    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70',
                    selected ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-hover-5 hover:text-fg',
                  )}
                >
                  <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden className={cn('shrink-0', selected ? 'text-fg' : 'text-fg-3')} />
                  <span className="truncate">{PAGE_META[p].label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
