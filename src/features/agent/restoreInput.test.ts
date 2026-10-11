import { describe, expect, it } from 'vitest'
import type { ThreadId, TurnId } from '@aiwc/protocol'
import { createThreadView, type PendingInput } from './model'
import { draftFromInputs, droppedPendingInputs, mergeRestoredDraft, reduceDroppedInputs } from './restoreInput'

const threadId = 'thr_r' as ThreadId
const turnId = 'trn_r' as TurnId
const pending = (id: string, text: string): PendingInput => ({
  clientInputId: id,
  content: [{ type: 'text', text }],
  mentions: [{ kind: 'contact', id: `c_${id}`, label: id }],
  mode: 'start',
  createdAt: 1,
})

describe('restoreInput', () => {
  it('rebuilds one draft from several inputs and keeps what the composer already holds after it', () => {
    const restored = draftFromInputs([pending('a', '第一句'), pending('b', '第二句')])
    expect(restored.text).toBe('第一句\n\n第二句')
    expect(restored.mentions.map((m) => m.id)).toEqual(['c_a', 'c_b'])
    expect(mergeRestoredDraft({ text: '新打的', mentions: [] }, restored).text).toBe('第一句\n\n第二句\n\n新打的')
    expect(mergeRestoredDraft(undefined, restored)).toEqual(restored)
  })

  it('drops only the pending inputs the aborted turn named and marks its error card', () => {
    const view = {
      ...createThreadView(threadId),
      pendingInputs: [pending('lost', 'x'), pending('kept', 'y')],
      items: [{ kind: 'error' as const, id: 'e', turnId, error: { code: 'auth', message: 'm' }, actions: [] }],
    }
    expect(droppedPendingInputs(view, ['lost']).map((p) => p.clientInputId)).toEqual(['lost'])
    const next = reduceDroppedInputs(view, {
      type: 'turn.aborted',
      threadId,
      turnId,
      reason: 'error',
      droppedClientInputIds: ['lost'],
    })
    expect(next.pendingInputs?.map((p) => p.clientInputId)).toEqual(['kept'])
    expect(next.items[0]).toMatchObject({ inputRestored: true })
    // an abort that recorded its input changes nothing
    expect(reduceDroppedInputs(view, { type: 'turn.aborted', threadId, turnId, reason: 'interrupted' })).toBe(view)
  })
})
