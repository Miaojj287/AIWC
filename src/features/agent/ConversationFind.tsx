/**
 * Find bar of the Agent conversation (⌘F while focus is in the conversation): a floating card at the top-right of the
 * transcript with the query, "n / m", previous / next and close. Enter / ↓ = next, ⇧Enter / ↑ = previous, Esc closes
 * and gives focus back to where it was. Matches are painted with the CSS Custom Highlight API (no DOM rewriting), and
 * recomputed as the transcript changes (streaming text, expanded folds).
 */
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useT } from '@/i18n'
import { IconButton, SearchBox } from '@/kit'
import { clearMatches, FIND_SKIP_ATTR, findRanges, MAX_FIND_MATCHES, paintMatches, stepMatch } from './findMatches'

/** Re-match at most this often while the transcript streams. */
const REMATCH_DEBOUNCE_MS = 120
/** Space kept above a match scrolled into view. */
const SCROLL_MARGIN_PX = 48

export interface ConversationFindProps {
  /** The scrolling viewport; its content is what is searched. */
  viewportRef: RefObject<HTMLElement | null>
  /** Bumped by every ⌘F: opens the bar (or re-focuses it). */
  requestSeq: number
}

export function ConversationFind({ viewportRef, requestSeq }: ConversationFindProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const seenSeq = useRef(requestSeq)
  /** Bumped per request so a second ⌘F re-focuses an open bar. */
  const [focusTick, setFocusTick] = useState(0)

  // A new ⌘F request opens the bar (remembering where focus was, to give it back on close).
  useEffect(() => {
    if (requestSeq === seenSeq.current) return
    seenSeq.current = requestSeq
    if (document.activeElement instanceof HTMLElement && document.activeElement !== inputRef.current)
      returnFocusRef.current = document.activeElement
    setOpen(true)
    setFocusTick((n) => n + 1)
  }, [requestSeq])

  // …and selects its query once the bar is on screen.
  useEffect(() => {
    if (!open || focusTick === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, focusTick])

  // Match now, and again whenever the transcript changes underneath.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!open || !viewport) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const match = () => {
      const next = findRanges(viewport, query)
      setRanges(next)
      setCurrent((c) => (next.length === 0 ? -1 : c < 0 || c >= next.length ? 0 : c))
    }
    match()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(match, REMATCH_DEBOUNCE_MS)
    })
    observer.observe(viewport, { subtree: true, childList: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [open, query, viewportRef])

  useEffect(() => {
    if (!open) return
    paintMatches(ranges, current)
    return clearMatches
  }, [open, ranges, current])

  // Bring the current match into view.
  useEffect(() => {
    const viewport = viewportRef.current
    const range = ranges[current]
    // Ranges have no layout outside a real engine (jsdom): nothing to scroll to then.
    if (!viewport || !range || typeof range.getBoundingClientRect !== 'function') return
    const rect = range.getBoundingClientRect()
    const box = viewport.getBoundingClientRect()
    if (rect.top >= box.top + SCROLL_MARGIN_PX && rect.bottom <= box.bottom - SCROLL_MARGIN_PX) return
    viewport.scrollTop += rect.top - box.top - SCROLL_MARGIN_PX
  }, [current, ranges, viewportRef])

  const close = () => {
    setOpen(false)
    setRanges([])
    setCurrent(-1)
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back?.isConnected) back.focus()
  }
  const step = (direction: 1 | -1) => setCurrent((c) => stepMatch(c, ranges.length, direction))

  if (!open) return null
  const count = ranges.length >= MAX_FIND_MATCHES ? `${MAX_FIND_MATCHES}+` : String(ranges.length)
  const status = !query.trim()
    ? ''
    : ranges.length === 0
      ? t('agent.stream.find.noResults')
      : t('agent.stream.find.position', { current: current + 1, total: count })
  return (
    <div
      role="search"
      aria-label={t('agent.stream.find.label')}
      className="absolute right-3 top-2 z-30 flex w-[min(320px,calc(100%-24px))] items-center gap-1 rounded-card border border-line-10 bg-overlay p-1.5 shadow-overlay"
      {...{ [FIND_SKIP_ATTR]: '' }}
    >
      <SearchBox
        ref={inputRef}
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder={t('agent.stream.find.placeholder')}
        aria-label={t('agent.stream.find.placeholder')}
        wrapperClassName="min-w-0 flex-1"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          } else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            step(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1)
          }
        }}
      />
      <span aria-live="polite" className="min-w-0 shrink-0 truncate px-1 text-micro tabular-nums text-fg-3">
        {status}
      </span>
      <IconButton
        size="sm"
        icon={ChevronUp}
        label={t('agent.stream.find.previous')}
        disabled={ranges.length === 0}
        onClick={() => step(-1)}
      />
      <IconButton
        size="sm"
        icon={ChevronDown}
        label={t('agent.stream.find.next')}
        disabled={ranges.length === 0}
        onClick={() => step(1)}
      />
      <IconButton size="sm" icon={X} label={t('common.close')} onClick={close} />
    </div>
  )
}
