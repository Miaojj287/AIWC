/**
 * AgentPet — the Codex-style companion in the Agent panel. `perched` sits on the composer's top edge
 * with a one-line status bubble; `mini` lives in the collapsed Agent strip (no bubble, click expands).
 * It mirrors the active thread: runs while the Agent works, waits when a 二次确认 is open, cheers or
 * slumps when the turn ends, and otherwise breathes with an occasional wave (CLAUDE.md §5: the Agent
 * still only speaks in the panel — the pet only reflects state).
 */
import { Check, CircleAlert, Clock, EyeOff, Hand, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { InstalledPet, PetConfig } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  cn,
  ICON_STROKE,
  Spinner,
  Tooltip,
  type MenuSpec,
} from '@/kit'
import { PetSprite } from './PetSprite'
import {
  bubbleFor,
  MOOD_ANIMATION,
  moodFor,
  moodLabel,
  moodLoops,
  nextFlairDelay,
  REACTION_BUBBLE_MS,
  REACTION_CYCLES,
  type AgentPetSignal,
  type PetBubble,
} from './petModel'
import { flairPool, PET_SCALE, scaledFrame, type PetAnimationId } from './spriteSpec'
import { usePrefersReducedMotion } from './useSpriteFrame'

export interface AgentPetProps {
  pet: InstalledPet
  config: PetConfig
  signal: AgentPetSignal
  variant?: 'perched' | 'mini'
  /** 宠物设置… (and 更换宠物). */
  onOpenSettings: () => void
  /** 隐藏宠物; omitted in the mini strip. */
  onHide?: () => void
  /** Mini: click expands the Agent panel. */
  onActivate?: () => void
  className?: string
  style?: CSSProperties
}

const MINI_SCALE = 0.17
/** Transparent margin under most sprites' feet: the pet overlaps the composer edge by this much. */
export const PERCH_OVERLAP = 6
/** Vertical room the message list keeps free above the composer for a perched pet. */
export const perchInset = (size: PetConfig['size']): number => scaledFrame(PET_SCALE[size]).height - PERCH_OVERLAP + 4

interface OneShot {
  animation: PetAnimationId
  nonce: number
}

const HOVER_WAVE_GAP_MS = 5_000

export function AgentPet({
  pet,
  config,
  signal,
  variant = 'perched',
  onOpenSettings,
  onHide,
  onActivate,
  className,
  style,
}: AgentPetProps) {
  const t = useT()
  const reduced = usePrefersReducedMotion()
  const motion = config.motion && !reduced
  const [now, setNow] = useState(() => Date.now())
  const [interaction, setInteraction] = useState<OneShot | null>(null)
  const [flair, setFlair] = useState<OneShot | null>(null)
  const [settled, setSettled] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const lastWave = useRef(0)
  const nonce = useRef(0)

  // Re-render when a finished turn's reaction window runs out.
  const reactionKey = signal.reaction?.key
  const reactionEnds = signal.reaction ? signal.reaction.at + REACTION_BUBBLE_MS[signal.reaction.outcome] : undefined
  useEffect(() => {
    setNow(Date.now())
    if (reactionEnds === undefined) return
    const remaining = reactionEnds - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), remaining + 20)
    return () => clearTimeout(timer)
  }, [reactionKey, reactionEnds])

  // Streaming / approval changes also refresh `now`, so a reaction never outlives a new turn.
  useEffect(() => setNow(Date.now()), [signal.streaming, signal.approval, signal.threadId])

  const mood = moodFor(signal, now)
  const busy = mood === 'running' || mood === 'waiting'

  // Idle flourish: an occasional wave / hop / look-around while nothing else is going on.
  useEffect(() => {
    if (!motion || !config.idleFlair || mood !== 'idle' || interaction || flair) return
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return setNow(Date.now())
      const pool = flairPool(pet.spriteVersion)
      nonce.current += 1
      setFlair({ animation: pool[Math.floor(Math.random() * pool.length)] ?? 'waving', nonce: nonce.current })
    }, nextFlairDelay())
    return () => clearTimeout(timer)
  }, [motion, config.idleFlair, mood, interaction, flair, pet.spriteVersion, now])

  const play = useCallback((animation: PetAnimationId) => {
    nonce.current += 1
    setFlair(null)
    setInteraction({ animation, nonce: nonce.current })
  }, [])

  // What to draw: state rows win; a poke / hover plays once; a finished turn plays its row a few times.
  let animation: PetAnimationId = MOOD_ANIMATION[mood]
  let repeat: number | undefined
  let onDone: (() => void) | undefined
  let restartKey: unknown = mood
  if (!busy && interaction) {
    animation = interaction.animation
    repeat = 1
    onDone = () => setInteraction(null)
    restartKey = interaction.nonce
  } else if ((mood === 'review' || mood === 'failed') && settled !== reactionKey) {
    repeat = REACTION_CYCLES
    onDone = () => setSettled(reactionKey)
    restartKey = reactionKey
  } else if (!moodLoops(mood)) {
    animation = 'idle'
  } else if (mood === 'idle' && flair) {
    animation = flair.animation
    repeat = 1
    onDone = () => setFlair(null)
    restartKey = flair.nonce
  }

  const bubble = variant === 'perched' && config.bubbles ? bubbleFor(signal, now) : undefined
  const visibleBubble = bubble && bubble.key !== dismissed ? bubble : undefined

  const mini = variant === 'mini'
  const scale = mini ? MINI_SCALE : PET_SCALE[config.size]
  const status = moodLabel(mood)

  const menu: MenuSpec = [
    { id: 'poke', label: t('pets.pet.poke'), icon: Hand, disabled: busy || !motion, onSelect: () => play('jumping') },
    { type: 'separator' },
    { id: 'settings', label: t('pets.pet.change'), icon: Settings2, onSelect: onOpenSettings },
    ...(onHide
      ? ([
          { type: 'separator' },
          { id: 'hide', label: t('pets.pet.hide'), icon: EyeOff, onSelect: onHide },
        ] satisfies MenuSpec)
      : []),
  ]

  const sprite = (
    <PetSprite
      src={pet.spriteUrl}
      version={pet.spriteVersion}
      animation={animation}
      scale={scale}
      playing={motion}
      repeat={repeat}
      onDone={onDone}
      restartKey={restartKey}
    />
  )

  const button = (
    <button
      type="button"
      aria-label={t('pets.pet.label', { name: pet.displayName, status })}
      data-mood={mood}
      onClick={() => {
        if (mini) onActivate?.()
        else if (!busy && motion) play('jumping')
      }}
      onPointerEnter={() => {
        if (mini || busy || !motion || interaction) return
        const at = Date.now()
        if (at - lastWave.current < HOVER_WAVE_GAP_MS) return
        lastWave.current = at
        play('waving')
      }}
      className={cn(
        'pointer-events-auto flex shrink-0 cursor-pointer items-end justify-center rounded-item outline-none transition-transform duration-(--dur-fast)',
        'focus-visible:ring-2 focus-visible:ring-accent/70 active:scale-95',
      )}
    >
      {sprite}
    </button>
  )

  const tooltipDetail = bubble
    ? bubble.detail
      ? t('pets.bubble.withDetail', { title: bubble.title, detail: bubble.detail })
      : bubble.title
    : status

  return (
    <div
      data-testid={mini ? 'agent-pet-mini' : 'agent-pet'}
      className={cn(mini ? 'flex justify-center' : 'pointer-events-none flex items-end gap-1.5', className)}
      style={style}
    >
      {visibleBubble ? (
        <PetBubbleView
          bubble={visibleBubble}
          onDismiss={() => setDismissed(visibleBubble.key)}
          petHeight={scaledFrame(scale).height}
        />
      ) : null}
      <ContextMenu>
        <Tooltip
          content={pet.displayName}
          description={
            mini
              ? t('pets.pet.tooltipMini', { detail: tooltipDetail })
              : t('pets.pet.tooltip', { detail: tooltipDetail })
          }
          side={mini ? 'left' : 'top'}
        >
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuItems items={menu} />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

const BUBBLE_ICON = {
  running: <Spinner size={12} />,
  waiting: <Clock size={12} strokeWidth={ICON_STROKE} aria-hidden className="text-accent" />,
  review: <Check size={12} strokeWidth={2} aria-hidden className="text-ok" />,
  failed: <CircleAlert size={12} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
} as const

/** Same floating style as the kit Tooltip (raised ground, r6, toast shadow) — no new overlay style. */
function PetBubbleView({
  bubble,
  onDismiss,
  petHeight,
}: {
  bubble: PetBubble
  onDismiss: () => void
  petHeight: number
}) {
  const t = useT()
  return (
    <button
      type="button"
      role="status"
      aria-live="polite"
      title={t('pets.bubble.dismiss')}
      onClick={onDismiss}
      data-tone={bubble.tone}
      data-state="open"
      className="kit-menu pointer-events-auto flex max-w-[200px] items-start gap-1.5 rounded-control bg-raised px-2 py-1.5 text-left text-note text-fg shadow-toast outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      style={{ marginBottom: Math.round(petHeight * 0.42) }}
    >
      <span className="mt-0.5 flex size-3 shrink-0 items-center justify-center">{BUBBLE_ICON[bubble.tone]}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium leading-4">{bubble.title}</span>
        {bubble.detail ? (
          <span className="line-clamp-2 break-all text-micro leading-4 text-fg-2">{bubble.detail}</span>
        ) : null}
      </span>
    </button>
  )
}
