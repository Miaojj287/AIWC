/**
 * Header of the search tab — the object-tab header of CLAUDE.md §14 (min-h 72, px-5 py-3, bold title) holding the
 * search box, the chats to search and the time range. The box searches as you type once a pause follows at least
 * two characters, and at once on Enter; neither fires mid-composition (pinyin letters are not the query).
 * SearchTab remounts it (key) for every `tab.openSearch`, so it starts from that request's query and takes focus.
 */
import { useEffect, useEffectEvent, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import type { WxSession } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Avatar, SearchBox, Select, type SelectOption } from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { usePagedSessions } from '@/platform/sessionPaging'
import {
  LIVE_DEBOUNCE_MS,
  liveCommit,
  RANGE_PRESETS,
  rangeLabel,
  type RangePreset,
  type SearchRange,
} from './searchModel'

/** Scope option values that are not chat ids (wxids / chatroom ids never contain `*`). */
const ALL_CHATS = '*all'
const SOME_CHATS = '*some'
const LOADING_CHATS = '*loading'

export interface SearchHeaderProps {
  /** The query the box starts with (the request's). */
  initialQuery: string
  /** The query the results answer. */
  committed: string
  sessionIds: readonly string[]
  range: SearchRange
  /** Look up a chat's name and avatar (`undefined` while loading, `null` when unknown). */
  chat(id: string): WxSession | null | undefined
  /** The substrate is connected: the picker may list chats. */
  connected: boolean
  /** Focus the box on mount (the tab was just opened or asked to search). */
  autoFocus: boolean
  inputRef: RefObject<HTMLInputElement | null>
  /** A pause in typing: search this (or '' = back to the start page). */
  onCommit(query: string): void
  /** Enter: search this now. */
  onSubmit(query: string): void
  onScopeChange(sessionIds: string[]): void
  onRangeChange(range: SearchRange): void
}

export function SearchHeader({
  initialQuery,
  committed,
  sessionIds,
  range,
  chat,
  connected,
  autoFocus,
  inputRef,
  onCommit,
  onSubmit,
  onScopeChange,
  onRangeChange,
}: SearchHeaderProps) {
  const t = useT()
  const [draft, setDraft] = useState(initialQuery)
  const [composing, setComposing] = useState(false)

  const focusOnMount = useEffectEvent(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    inputRef.current?.select()
  })
  useEffect(() => focusOnMount(), [])

  // Live search after a pause; the callback is read when the timer fires, so a re-render does not restart the wait.
  const commitLater = useEffectEvent((query: string) => onCommit(query))
  useEffect(() => {
    if (composing) return
    const next = liveCommit(draft, committed)
    if (next === undefined) return
    const timer = setTimeout(() => commitLater(next), LIVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, committed, composing])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    // Handled here rather than through SearchBox's onSubmit, which would also fire on the Enter that ends a composition.
    e.preventDefault()
    const query = draft.trim()
    if (query) onSubmit(query)
  }

  const recent = usePagedSessions('', connected)
  const scopeOptions = useMemo(() => {
    const options: Array<SelectOption> = [{ value: ALL_CHATS, label: t('search.scope.all') }]
    if (sessionIds.length > 1)
      options.push({ value: SOME_CHATS, label: t('search.scope.some', { n: sessionIds.length }) })
    const listed = new Set<string>()
    const add = (id: string, session: WxSession | null | undefined) => {
      if (listed.has(id)) return
      listed.add(id)
      const name = session?.title || t('search.scope.some', { n: 1 })
      options.push({
        value: id,
        label: name,
        leading: <Avatar id={id} name={name} size={20} src={toMediaUrl(session?.avatarPath)} />,
      })
    }
    for (const id of sessionIds) add(id, chat(id) ?? recent.items.find((s) => s.id === id))
    for (const session of recent.items) add(session.id, session)
    if (recent.loading) options.push({ value: LOADING_CHATS, label: t('search.scope.loading'), disabled: true })
    return options
  }, [sessionIds, chat, recent.items, recent.loading, t])
  const scopeValue = sessionIds.length === 0 ? ALL_CHATS : sessionIds.length === 1 ? sessionIds[0] : SOME_CHATS

  const rangeOptions = useMemo(() => {
    const options: Array<SelectOption<RangePreset | 'custom'>> = RANGE_PRESETS.map((p) => ({
      value: p.value,
      label: t(p.labelKey),
    }))
    if (range.preset === 'custom') options.push({ value: 'custom', label: rangeLabel(range) })
    return options
  }, [range, t])

  return (
    <header className="flex min-h-18 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-6 px-5 py-3">
      <h1 className="shrink-0 text-bubble font-semibold leading-5 text-fg">{t('search.header.title')}</h1>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <SearchBox
          ref={inputRef}
          value={draft}
          onValueChange={setDraft}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder={t('search.header.input')}
          aria-label={t('search.header.input')}
          wrapperClassName="min-w-[220px] flex-1"
        />
        <Select
          options={scopeOptions}
          value={scopeValue}
          onValueChange={(value) => {
            if (value === ALL_CHATS) onScopeChange([])
            else if (value !== SOME_CHATS && value !== LOADING_CHATS) onScopeChange([value])
          }}
          searchable
          searchPlaceholder={t('search.scope.find')}
          emptyText={t('search.scope.none')}
          aria-label={t('search.header.scope')}
          size="lg"
          className="max-w-[220px]"
        />
        <Select
          options={rangeOptions}
          value={range.preset}
          onValueChange={(value) => {
            if (value !== 'custom') onRangeChange({ preset: value })
          }}
          aria-label={t('search.header.range')}
          size="lg"
        />
      </div>
    </header>
  )
}
