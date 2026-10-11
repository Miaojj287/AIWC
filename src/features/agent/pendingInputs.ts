/**
 * Input the kernel has not recorded yet. A message sent while the agent works is a steer: the kernel keeps it until
 * the current step ends, so without this it would vanish from the composer and appear nowhere. The prompt of a new
 * turn likewise waits behind pre-turn work (hooks, compaction). Each submitted input carries a clientInputId; the
 * `item.user` that records it echoes the id, which is what replaces the pending copy — never a comparison of text.
 *
 * Also here: the prompt left without an answer (the app quit or crashed mid-turn), which the transcript offers to
 * resend. Pure — tested in pendingInputs.test.ts.
 */
import type { TurnId } from '@aiwc/protocol'
import type { PendingInput, ThreadItem, ThreadViewState } from './model'
import type { TimelineEntry, TurnSegment } from './turnSegments'

type UserItem = Extract<ThreadItem, { kind: 'user' }>

const NO_PENDING: readonly PendingInput[] = []

/** Pending inputs of a view (empty when none). */
export const pendingInputsOf = (view: ThreadViewState | undefined): readonly PendingInput[] =>
  view?.pendingInputs ?? NO_PENDING

/**
 * Mode for the next send: steer while a turn runs or is still starting (a second 'start' would replace a turn that
 * has not shown anything yet), otherwise start.
 */
export const sendModeFor = (view: ThreadViewState | undefined): PendingInput['mode'] =>
  view?.isStreaming || pendingInputsOf(view).length > 0 ? 'steer' : 'start'

export function addPendingInput(view: ThreadViewState, input: PendingInput): ThreadViewState {
  return { ...view, pendingInputs: [...pendingInputsOf(view), input] }
}

/** The list without the input of this id; the same array when it holds no such input (or no id was given). */
export function withoutPendingInput(
  list: PendingInput[] | undefined,
  clientInputId: string | undefined,
): PendingInput[] | undefined {
  if (!list || !clientInputId || !list.some((p) => p.clientInputId === clientInputId)) return list
  const next = list.filter((p) => p.clientInputId !== clientInputId)
  return next.length > 0 ? next : undefined
}

/** A pending input drawn as a prompt (it is not part of the history, so its id can never collide with one). */
export function pendingAsUserItem(input: PendingInput, turnId: TurnId | undefined): UserItem {
  return {
    kind: 'user',
    id: `pending_${input.clientInputId}`,
    turnId: turnId ?? (`pending_${input.clientInputId}` as TurnId),
    content: input.content,
    mentions: input.mentions,
    createdAt: input.createdAt,
  }
}

/** Key buildTimeline gives the running segment of a turn that has not shown any item yet. */
const isPlaceholderSegment = (segment: TurnSegment): boolean =>
  segment.key.startsWith('pending_') && !segment.user && segment.body.length === 0

export interface PlacedPendingInputs {
  timeline: TimelineEntry[]
  /** Steers (and anything else that is not the opening prompt) shown after the transcript, oldest first. */
  trailing: PendingInput[]
}

/**
 * Where pending inputs appear. The prompt of a starting turn opens that turn: it becomes the prompt of the running
 * placeholder segment, or of a segment of its own until the turn has started. Steers are listed after the
 * transcript: the step they wait for keeps adding rows above them, and drawing them as prompts would close the
 * running turn early.
 */
export function placePendingInputs(timeline: TimelineEntry[], pending: readonly PendingInput[]): PlacedPendingInputs {
  if (pending.length === 0) return { timeline, trailing: [] }
  const opening = pending.find((p) => p.mode === 'start')
  const trailing = pending.filter((p) => p !== opening)
  if (!opening) return { timeline, trailing }
  const last = timeline[timeline.length - 1]
  if (last?.kind === 'segment' && isPlaceholderSegment(last.segment)) {
    const segment: TurnSegment = { ...last.segment, user: pendingAsUserItem(opening, last.segment.turnId) }
    return { timeline: [...timeline.slice(0, -1), { kind: 'segment', segment }], trailing }
  }
  const segment: TurnSegment = {
    key: `pending_input_${opening.clientInputId}`,
    user: pendingAsUserItem(opening, undefined),
    body: [],
    status: 'running',
    foldable: false,
    startedAt: opening.createdAt,
  }
  return { timeline: [...timeline, { kind: 'segment', segment }], trailing }
}

/** Kinds that show the agent did something with the prompt before them. */
const ANSWERED_BY: ReadonlySet<ThreadItem['kind']> = new Set<ThreadItem['kind']>([
  'tools',
  'artifact',
  'plan',
  'error',
  'aborted',
  'revision',
])

/**
 * The last prompt when nothing came after it: no reply, no tool call, no error or stop marker. That is what a turn
 * cut off by a quit or a crash leaves behind (a stopped or failed turn records its own marker).
 */
export function unansweredPrompt(items: readonly ThreadItem[]): UserItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item) continue
    if (item.kind === 'user') return item
    if (ANSWERED_BY.has(item.kind)) return undefined
    if (item.kind === 'assistant' && (item.text.trim() || item.reasoning?.trim())) return undefined
  }
  return undefined
}
