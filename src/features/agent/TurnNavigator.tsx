/**
 * Turn navigator — a minimap rail on the left edge of a wide conversation: one tick per prompt, the tick for the turn
 * in view drawn solid. Hovering magnifies the ticks around the pointer and shows the prompt with the start of its
 * reply; clicking scrolls that turn to the top. Only shown with two or more prompts in a conversation at least 864px
 * wide (container query), so the 360px panel never shows it.
 */
import { useEffect, useState, type RefObject } from 'react'
import { useT } from '@/i18n'
import { cn, Tooltip } from '@/kit'

/** Characters of the reply previewed in a tick's tooltip. */
const REPLY_PREVIEW_CHARS = 220
/** Space kept above a turn scrolled into view, and the band under the top edge that counts as "in view". */
const TOP_OFFSET_PX = 16

export interface NavigatorTurn {
  key: string
  prompt: string
  /** Text of the turn's reply so far (empty while nothing arrived). */
  reply: string
  running: boolean
}

/** scaleX / opacity of a tick by its distance from the hovered one. */
const FISHEYE: ReadonlyArray<readonly [number, number]> = [
  [2.6, 1],
  [1.7, 0.86],
  [1.25, 0.72],
]

function turnElement(viewport: HTMLElement, key: string): HTMLElement | undefined {
  for (const el of viewport.querySelectorAll<HTMLElement>('[data-turn]')) if (el.dataset.turn === key) return el
  return undefined
}

export function TurnNavigator({
  turns,
  viewportRef,
}: {
  turns: NavigatorTurn[]
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const [hovered, setHovered] = useState<number | undefined>(undefined)
  const [current, setCurrent] = useState<string | undefined>(undefined)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => {
      const top = viewport.getBoundingClientRect().top + TOP_OFFSET_PX * 2
      let key = turns[0]?.key
      for (const turn of turns) {
        const el = turnElement(viewport, turn.key)
        if (el && el.getBoundingClientRect().top <= top) key = turn.key
      }
      setCurrent(key)
    }
    update()
    viewport.addEventListener('scroll', update, { passive: true })
    return () => viewport.removeEventListener('scroll', update)
  }, [turns, viewportRef])

  const jump = (key: string) => {
    const viewport = viewportRef.current
    const el = viewport ? turnElement(viewport, key) : null
    if (!viewport || !el) return
    const top = el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    viewport.scrollTo({ top: Math.max(0, top - TOP_OFFSET_PX), behavior: 'smooth' })
  }

  if (turns.length < 2) return null
  return (
    <nav
      aria-label={t('agent.navigator.label')}
      className="absolute inset-y-0 left-0 z-10 hidden w-12 items-center @min-[864px]/conversation:flex"
    >
      <div
        className="ml-3 flex max-h-[calc(100%-6rem)] w-9 flex-col overflow-y-auto [scrollbar-width:none]"
        onMouseLeave={() => setHovered(undefined)}
      >
        {turns.map((turn, i) => {
          const distance = hovered === undefined ? undefined : Math.abs(hovered - i)
          const [scale, opacity] =
            distance !== undefined && distance < FISHEYE.length
              ? (FISHEYE[distance] ?? [1, 0.58])
              : turn.key === current
                ? [1, 0.9]
                : [1, 0.58]
          const reply = turn.reply.trim()
          return (
            <Tooltip
              key={turn.key}
              side="right"
              align="center"
              sideOffset={8}
              multiline
              content={
                <span className="flex flex-col gap-1">
                  <span className="line-clamp-2 font-medium text-fg">{turn.prompt}</span>
                  <span className="line-clamp-3 text-fg-2">
                    {reply
                      ? reply.slice(0, REPLY_PREVIEW_CHARS)
                      : t(turn.running ? 'agent.navigator.working' : 'agent.navigator.noReply')}
                  </span>
                </span>
              }
            >
              <button
                type="button"
                aria-label={t('agent.navigator.jump', { n: i + 1, prompt: turn.prompt.slice(0, 40) })}
                aria-current={turn.key === current ? 'true' : undefined}
                onMouseEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(undefined)}
                onClick={() => jump(turn.key)}
                className="flex h-2.5 w-9 shrink-0 items-center outline-none"
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-0.5 w-3 origin-left rounded-chip transition-[transform,opacity]',
                    turn.key === current ? 'bg-fg' : 'bg-fg-3',
                  )}
                  style={{ transform: `scaleX(${scale})`, opacity }}
                />
              </button>
            </Tooltip>
          )
        })}
      </div>
    </nav>
  )
}
