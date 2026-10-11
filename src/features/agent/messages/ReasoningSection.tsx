import { Brain, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { cn, ICON_STROKE } from '@/kit'

/** Characters of the newest reasoning line kept next to the live label; the row truncates the rest. */
const LIVE_LINE_CHARS = 120

/** The newest non-empty line of the reasoning so far (the tail of it when it is long). */
function latestLine(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (line) return line.length > LIVE_LINE_CHARS ? `…${line.slice(-LIVE_LINE_CHARS)}` : line
  }
  return ''
}

/**
 * Provider-supplied reasoning as a single row. It stays collapsed unless the user opens it. While the model thinks,
 * the label shimmers and trails the newest reasoning line; afterwards it reads 已思考. The expanded text is the
 * reasoning verbatim in a capped, scrolling column that follows the stream.
 */
export function ReasoningSection({ text, active }: { text: string; active: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const live = active ? latestLine(text) : ''

  useEffect(() => {
    if (!open || !active) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, active, text])

  return (
    <div className="flex min-w-0 flex-col" data-item="reasoning">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className="group/reasoning -mx-1 flex h-7 min-w-0 max-w-full items-center gap-2 self-start rounded-control px-1 text-body text-fg-3 outline-none hover:text-fg-2"
      >
        <Brain size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
        <span className={cn('shrink-0 font-medium', active && 'kit-shimmer text-fg-2')}>
          {t(active ? 'agent.turn.thinking' : 'agent.message.thought')}
        </span>
        {live ? (
          <>
            <span aria-hidden className="shrink-0">
              ·
            </span>
            <span aria-hidden className="min-w-0 truncate">
              {live}
            </span>
          </>
        ) : null}
        <ChevronRight
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn(
            'shrink-0 opacity-0 transition-[opacity,transform] group-hover/reasoning:opacity-70 group-focus-visible/reasoning:opacity-70',
            open && 'rotate-90 opacity-70',
          )}
        />
      </button>
      <div id={contentId} hidden={!open}>
        {open ? (
          <div ref={bodyRef} className="ml-[7px] mt-1.5 max-h-60 overflow-y-auto border-l border-line-8 pl-3.5">
            <p className="m-0 whitespace-pre-wrap break-words text-caption leading-5 text-fg-3 select-text">{text}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
