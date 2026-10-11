/**
 * Input that never reached the kernel's history goes back into the composer instead of vanishing: a send whose IPC
 * failed, or a turn that ended before recording its prompt (a blocking hook, no usable model, Stop during pre-turn
 * work — the kernel names those inputs in turn.aborted's `droppedClientInputIds`). The restored text comes first and
 * whatever the user has typed since stays after it; nothing in the composer is overwritten. Pure — tested in
 * restoreInput.test.ts.
 */
import type { ContentPart, Event, Mention } from '@aiwc/protocol'
import { draftAttachmentsOf } from './composer/attachments'
import { addMention } from './mentions'
import { emptyDraft, type ComposerDraft, type PendingInput, type ThreadViewState } from './model'
import { pendingInputsOf } from './pendingInputs'
import { mergeIntoDraft } from './queuedInputs'

const typedText = (content: readonly ContentPart[]): string =>
  content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n')
    .trim()

/** One draft holding the text, chips and attachments of the given inputs, oldest first. */
export function draftFromInputs(inputs: ReadonlyArray<{ content: ContentPart[]; mentions: Mention[] }>): ComposerDraft {
  const attachments = inputs.flatMap((input) => draftAttachmentsOf(input.content))
  return {
    text: inputs
      .map((input) => typedText(input.content))
      .filter(Boolean)
      .join('\n\n'),
    mentions: inputs.flatMap((input) => input.mentions).reduce((list, m) => addMention(list, m), [] as Mention[]),
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

/** `restored` put back into the composer ahead of what it holds now (`current` is kept, never replaced). */
export function mergeRestoredDraft(current: ComposerDraft | undefined, restored: ComposerDraft): ComposerDraft {
  const { attachments, ...merged } = mergeIntoDraft(restored, current ?? emptyDraft())
  return attachments?.length ? { ...merged, attachments } : merged
}

/** The pending inputs of a view that an aborted turn reported as never recorded. */
export function droppedPendingInputs(
  view: ThreadViewState | undefined,
  droppedClientInputIds: readonly string[] | undefined,
): PendingInput[] {
  if (!droppedClientInputIds?.length) return []
  const ids = new Set(droppedClientInputIds)
  return pendingInputsOf(view).filter((p) => ids.has(p.clientInputId))
}

/**
 * turn.aborted that names unrecorded input: those pending copies leave the transcript (the store puts them back into
 * the composer), and the turn's error card learns that 重试 means sending them again.
 */
export function reduceDroppedInputs(state: ThreadViewState, e: Event): ThreadViewState {
  if (e.type !== 'turn.aborted' || !e.droppedClientInputIds?.length || e.threadId !== state.threadId) return state
  const ids = new Set(e.droppedClientInputIds)
  const pending = pendingInputsOf(state).filter((p) => !ids.has(p.clientInputId))
  return {
    ...state,
    pendingInputs: pending.length > 0 ? pending : undefined,
    items: state.items.map((it) =>
      it.kind === 'error' && it.turnId === e.turnId ? { ...it, inputRestored: true } : it,
    ),
  }
}
