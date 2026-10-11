import { describe, expect, it } from 'vitest'
import type { Event } from '@aiwc/protocol'
import { createMockModelClient } from './model/mock'
import { postAssistantNote } from './notes'
import { createThreadHarness, userInput } from './testing/harness'
import { waitForEvent } from './testing/fakes'

const turnEvents = (events: readonly Event[]) =>
  events.flatMap((e) =>
    e.type === 'turn.started' || e.type === 'turn.completed' || e.type === 'turn.aborted' || e.type === 'item.user'
      ? [{ type: e.type, turnId: e.turnId, kind: 'kind' in e ? e.kind : undefined }]
      : [],
  )

describe('postAssistantNote', () => {
  it('waits for the running turn without blocking steers, and never lands inside a turn started meanwhile', async () => {
    const model = createMockModelClient([
      { text: '一段比较长的回答，分成很多块慢慢流出来。', delayMs: 5, chunkSize: 2 },
      { text: '第二个回合' },
    ])
    const h = await createThreadHarness({ model })
    const first = await h.thread.startTurn(userInput('第一句'), 'start')
    await waitForEvent(h.emitter.on, 'text.delta')
    const note = postAssistantNote(h.thread, h.emitter.emit, '提醒：开会', Date.now)
    // a steer sent while the note waits still joins the running turn
    const steered = await h.thread.startTurn(userInput('补充'), 'steer')
    expect(steered.turnId).toBe(first.turnId)
    await first.promise
    // a turn requested right after the first one ends queues behind the note instead of wrapping around it
    const second = await h.thread.startTurn(userInput('第二句'), 'start')
    await note
    await second.promise

    const seq = turnEvents(h.events.events)
    const noteStart = seq.findIndex((e) => e.type === 'turn.started' && e.kind === 'note')
    expect(noteStart).toBeGreaterThan(-1)
    const noteTurn = seq[noteStart]!.turnId
    expect(seq[noteStart + 1]).toEqual({ type: 'turn.completed', turnId: noteTurn, kind: 'note' })
    expect(seq.filter((e) => e.type === 'item.user' && e.turnId === first.turnId)).toHaveLength(2)
    // the note comes after the first turn completed
    const firstDone = seq.findIndex((e) => e.type === 'turn.completed' && e.turnId === first.turnId)
    expect(noteStart).toBeGreaterThan(firstDone)
  })
})
