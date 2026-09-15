/**
 * Sender multi-select of the sync bar (Figma 149:415 ⑤ 所有人 · 发送者筛选). A DropdownMenu with
 * checkbox items — empty selection means everyone.
 */
import { ChevronDown, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  cn,
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SearchBox,
  Spinner,
} from '@/kit'
import { useT } from '@/i18n'

export interface SenderOption {
  id: string
  name: string
  /** Second line: remark / role. */
  detail?: string
  avatar?: string
}

export interface SenderFilterProps {
  options: SenderOption[]
  value: string[]
  onChange(ids: string[]): void
  loading?: boolean
}

const SEARCH_THRESHOLD = 12
const MAX_VISIBLE = 200

export function SenderFilter({ options, value, onChange, loading = false }: SenderFilterProps) {
  const t = useT()
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  const all = value.length === 0
  const label = all
    ? t('chat.senders.everyone')
    : value.length === 1
      ? (options.find((o) => o.id === value[0])?.name ?? t('chat.senders.count', { n: 1 }))
      : t('chat.senders.count', { n: value.length })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
        )
      : options
    return list.slice(0, MAX_VISIBLE)
  }, [options, query])

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    // Selecting everyone is the same as no filter.
    onChange(next.size === options.length ? [] : [...next])
  }

  return (
    <DropdownMenu onOpenChange={(o) => !o && setQuery('')}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="link"
          size="sm"
          icon={Users}
          trailingIcon={ChevronDown}
          className={cn('min-w-0 max-w-[200px]', all && 'text-fg-2 hover:text-fg')}
          aria-label={t('chat.senders.label')}
        >
          <span className="min-w-0 truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px] max-w-[280px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        {options.length > SEARCH_THRESHOLD ? (
          <div className="px-0.5 pb-1" onKeyDown={(e) => e.stopPropagation()}>
            <SearchBox
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder={t('chat.senders.search')}
              aria-label={t('chat.senders.search')}
            />
          </div>
        ) : null}
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>
            {all
              ? t('chat.senders.everyoneCount', { n: options.length })
              : t('chat.senders.selectedOf', { n: value.length, total: options.length })}
          </span>
          {all ? null : (
            <Button variant="link" size="sm" onClick={() => onChange([])} className="h-auto px-1 py-0 text-micro">
              {t('common.clear')}
            </Button>
          )}
        </DropdownMenuLabel>
        <div className="flex max-h-[320px] flex-col gap-px overflow-y-auto">
          <DropdownMenuCheckboxItem
            checked={all}
            onCheckedChange={() => onChange([])}
            onSelect={(e) => e.preventDefault()}
            icon={Users}
          >
            {t('chat.senders.everyone')}
          </DropdownMenuCheckboxItem>
          {loading ? (
            <div className="flex h-[30px] items-center gap-2 px-2 text-caption text-fg-3">
              <Spinner size={12} /> {t('chat.senders.loading')}
            </div>
          ) : null}
          {visible.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={selected.has(o.id)}
              onCheckedChange={(c) => toggle(o.id, c === true)}
              onSelect={(e) => e.preventDefault()}
              description={o.detail}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar id={o.id} name={o.name} src={o.avatar} size={20} />
                <span className="min-w-0 truncate">{o.name}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {!loading && visible.length === 0 ? (
            <div className="px-2 py-2 text-caption text-fg-3">{t('chat.senders.noMatches')}</div>
          ) : null}
          {options.length > MAX_VISIBLE && visible.length === MAX_VISIBLE ? (
            <div className="px-2 py-1 text-micro text-fg-3">{t('chat.senders.truncated', { n: MAX_VISIBLE })}</div>
          ) : null}
        </div>
        {all ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>{t('chat.senders.showEveryone')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
