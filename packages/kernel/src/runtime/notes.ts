/**
 * A note the host posts into a thread without a model call — a 定时任务 reminder ("半小时后提醒我…") appearing in
 * the conversation it was set up from. It is an ordinary assistant message in a turn of its own (history stays
 * append-only, the model sees it as context next time), announced with the usual turn / text events so open
 * panels show it live. It waits for a running turn to end first and runs in the thread's op queue, so it never lands
 * inside someone else's turn; its turn events carry `kind: 'note'` (no user input, never releases queued messages).
 */
import { newItemId, newStepId, newTurnId, type AssistantMessageItem } from '@aiwc/protocol'
import type { Emitter } from './emitter'
import type { Thread } from './thread'

/** modelId recorded on notes, so the panel and exports can tell them from model replies. */
export const NOTE_MODEL_ID = 'aiwc-note'

export async function postAssistantNote(
  thread: Thread,
  emit: Emitter['emit'],
  text: string,
  clock: () => number,
): Promise<void> {
  // Posted inside the thread's op queue so no turn can start mid-note. A running turn is awaited OUTSIDE the queue:
  // holding the queue for it would turn the user's steers into turns of their own.
  for (;;) {
    const busy = await thread.serialize(async () => {
      if (thread.activeTurn) return thread.activeTurn
      if (thread.isClosed) throw new Error(`thread ${thread.id} is shut down`)
      await writeNote(thread, emit, text, clock)
      return undefined
    })
    if (!busy) return
    await busy.promise.catch(() => undefined)
  }
}

async function writeNote(thread: Thread, emit: Emitter['emit'], text: string, clock: () => number): Promise<void> {
  const turnId = newTurnId()
  const at = clock()
  const item: AssistantMessageItem = {
    type: 'assistant_message',
    id: newItemId(),
    turnId,
    stepId: newStepId(),
    createdAt: at,
    text,
    modelId: NOTE_MODEL_ID,
  }
  const kind = 'note'
  emit({ type: 'turn.started', threadId: thread.id, turnId, at, kind })
  thread.record([item])
  emit({ type: 'text.start', threadId: thread.id, turnId, itemId: item.id })
  emit({ type: 'text.end', threadId: thread.id, turnId, itemId: item.id, text })
  try {
    await thread.flush()
  } catch (err) {
    // never leave an open panel showing a turn that will not complete
    emit({ type: 'turn.aborted', threadId: thread.id, turnId, reason: 'error', kind })
    throw err
  }
  emit({
    type: 'turn.completed',
    threadId: thread.id,
    turnId,
    finalText: text,
    usage: { inputTokens: 0, outputTokens: 0 },
    steps: 0,
    at: clock(),
    kind,
  })
}
