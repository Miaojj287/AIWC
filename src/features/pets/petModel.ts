/**
 * What the pet does, as pure functions (tested without React). Mirrors the Codex app vocabulary
 * (Running / Needs input / Ready / Blocked); copy comes from the `pets` catalog at call time.
 */
import type { InstalledPet, PetConfig } from '@aiwc/protocol'
import { t } from '@/i18n'
import type { PetAnimationId } from './spriteSpec'

/** Everything the pet needs to know about the Agent (computed by the agent feature). */
export interface AgentPetSignal {
  /** Active Agent thread; switching threads drops old reactions. */
  threadId?: string
  streaming: boolean
  /** Summary of the first tool call waiting for 二次确认. */
  approval?: string
  /** Summary of the tool call running right now. */
  activity?: string
  /** The latest turn of this thread that finished while the app was open. */
  reaction?: PetReaction
}

export interface PetReaction {
  /** Unique per finished turn. */
  key: string
  outcome: 'completed' | 'failed'
  /** Final answer preview / error message. */
  message?: string
  at: number
}

export type PetMood = 'idle' | 'running' | 'waiting' | 'review' | 'failed'

export type PetBubbleTone = 'running' | 'waiting' | 'review' | 'failed'

export interface PetBubble {
  /** Identity for dismissal: a dismissed bubble stays hidden until the key changes. */
  key: string
  tone: PetBubbleTone
  title: string
  detail?: string
}

/** How long a finished turn keeps its reaction pose and bubble. */
export const REACTION_BUBBLE_MS: Record<PetReaction['outcome'], number> = { completed: 8_000, failed: 15_000 }

/** State rows play this many cycles before settling back into idle (Codex plays each state ×3). */
export const REACTION_CYCLES = 3

export function reactionActive(reaction: PetReaction | undefined, now: number): reaction is PetReaction {
  return Boolean(reaction) && now - reaction!.at < REACTION_BUBBLE_MS[reaction!.outcome]
}

/** Priority: needs you > working > just finished > idle. */
export function moodFor(signal: AgentPetSignal, now: number): PetMood {
  if (signal.approval !== undefined) return 'waiting'
  if (signal.streaming) return 'running'
  if (reactionActive(signal.reaction, now)) return signal.reaction.outcome === 'failed' ? 'failed' : 'review'
  return 'idle'
}

export const MOOD_ANIMATION: Record<PetMood, PetAnimationId> = {
  idle: 'idle',
  running: 'running',
  waiting: 'waiting',
  review: 'review',
  failed: 'failed',
}

/** Loop while the state lasts (working / waiting); play a finished-turn reaction a few times, then idle. */
export const moodLoops = (mood: PetMood): boolean => mood === 'running' || mood === 'waiting' || mood === 'idle'

const MAX_DETAIL = 60

export function clip(text: string | undefined, max = MAX_DETAIL): string | undefined {
  const flat = text?.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function bubbleFor(signal: AgentPetSignal, now: number): PetBubble | undefined {
  const mood = moodFor(signal, now)
  switch (mood) {
    case 'waiting':
      return {
        key: `waiting:${signal.threadId}:${signal.approval}`,
        tone: 'waiting',
        title: t('pets.bubble.waiting'),
        detail: clip(signal.approval),
      }
    case 'running':
      // The message list already says 正在生成; the bubble only adds which tool is running.
      return signal.activity
        ? {
            key: `running:${signal.threadId}:${signal.activity}`,
            tone: 'running',
            title: t('pets.bubble.running'),
            detail: clip(signal.activity),
          }
        : undefined
    case 'review':
      return {
        key: `review:${signal.reaction!.key}`,
        tone: 'review',
        title: t('pets.bubble.review'),
        detail: clip(signal.reaction!.message),
      }
    case 'failed':
      return {
        key: `failed:${signal.reaction!.key}`,
        tone: 'failed',
        title: t('pets.bubble.failed'),
        detail: clip(signal.reaction!.message),
      }
    default:
      return undefined
  }
}

/** One-line status for tooltips and screen readers. */
export function moodLabel(mood: PetMood): string {
  return t(`pets.mood.${mood}`)
}

/** Selected pet, else the first bundled pet, else anything installed. */
export function resolveCurrentPet(
  pets: readonly InstalledPet[],
  config: Pick<PetConfig, 'current'> | undefined,
): InstalledPet | undefined {
  return pets.find((p) => p.id === config?.current) ?? pets.find((p) => p.builtin) ?? pets[0]
}

/** Random wait before the next idle flourish (12–26 s). */
export const nextFlairDelay = (random: () => number = Math.random): number => 12_000 + Math.floor(random() * 14_000)

export function sourceLabel(pet: Pick<InstalledPet, 'source' | 'author'>): string {
  if (pet.source === 'builtin') return t('pets.source.builtin')
  if (pet.source === 'catalog')
    return pet.author ? t('pets.source.catalogBy', { author: pet.author }) : t('pets.source.catalog')
  return t('pets.source.import')
}
