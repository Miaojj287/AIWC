import { describe, expect, it } from 'vitest'
import { asItemId, asTurnId, type HistoryItem, type TurnId } from '@aiwc/protocol'
import { forkItems } from './fork'

const user = (id: string, turn: string): HistoryItem => ({
  type: 'user_message',
  id: asItemId(id),
  turnId: asTurnId(turn),
  createdAt: 1,
  content: [{ type: 'text', text: id }],
  mentions: [],
})
const reply = (id: string, turn: string): HistoryItem => ({
  type: 'assistant_message',
  id: asItemId(id),
  turnId: asTurnId(turn),
  stepId: 'stp_1' as never,
  createdAt: 2,
  text: id,
})

const history = [
  user('u1', 't1'),
  reply('a1', 't1'),
  user('u2', 't2'),
  user('s2', 't2'),
  reply('a2', 't2'),
  user('u3', 't3'),
  reply('a3', 't3'),
]
const ids = (items: readonly HistoryItem[]) => items.map((i) => i.id)

describe('forkItems', () => {
  it('keeps everything through the last item of the chosen turn, steers included', () => {
    const picked = forkItems(history, asItemId('u2'))
    expect(picked.ok && ids(picked.items)).toEqual(['u1', 'a1', 'u2', 's2', 'a2'])
  })

  it('accepts any item of the turn as the fork point', () => {
    const picked = forkItems(history, asItemId('a1'))
    expect(picked.ok && ids(picked.items)).toEqual(['u1', 'a1'])
  })

  it('refuses an item that is not in the history, and the turn that is still running', () => {
    expect(forkItems(history, asItemId('nope'))).toEqual({ ok: false, code: 'fork_target_missing' })
    expect(forkItems(history, asItemId('u3'), asTurnId('t3') as TurnId)).toEqual({
      ok: false,
      code: 'fork_turn_running',
    })
  })
})
