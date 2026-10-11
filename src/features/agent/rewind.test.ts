import { describe, expect, it } from 'vitest'
import type { TurnId } from '@aiwc/protocol'
import type { ThreadItem } from './model'
import { editedInput, inputOf, rewindPoint, turnPrompt } from './rewind'

const user = (id: string, turn: string, text = id): Extract<ThreadItem, { kind: 'user' }> => ({
  kind: 'user',
  id,
  turnId: turn as TurnId,
  content: [{ type: 'text', text }],
  mentions: [],
  createdAt: 1,
})
const reply = (id: string, turn: string): ThreadItem => ({
  kind: 'assistant',
  id,
  turnId: turn as TurnId,
  text: id,
  streaming: false,
  createdAt: 2,
})

const items: ThreadItem[] = [
  user('u1', 't1'),
  reply('a1', 't1'),
  user('u2', 't2'),
  user('s2', 't2'),
  reply('a2', 't2'),
  user('u3', 't3'),
  reply('a3', 't3'),
]

describe('rewindPoint', () => {
  it('cuts at the prompt and counts the user messages and later turns it discards', () => {
    expect(rewindPoint(items, 'u2')).toEqual({ index: 2, turns: 3, laterTurns: 1 })
    expect(rewindPoint(items, 'u3')).toEqual({ index: 5, turns: 1, laterTurns: 0 })
    expect(rewindPoint(items, 'u1')).toEqual({ index: 0, turns: 4, laterTurns: 2 })
  })

  it('only rewinds to a prompt', () => {
    expect(rewindPoint(items, 'a1')).toBeUndefined()
    expect(rewindPoint(items, 'missing')).toBeUndefined()
  })
})

describe('turnPrompt / inputs', () => {
  it('finds the prompt that opened a turn, or the last prompt without a turn', () => {
    expect(turnPrompt(items, 't2' as TurnId)?.id).toBe('u2')
    expect(turnPrompt(items, undefined)?.id).toBe('u3')
    expect(turnPrompt(items, 'nope' as TurnId)).toBeUndefined()
  })

  it('reruns the prompt as recorded and keeps attachments when edited', () => {
    const withImage = {
      ...user('u9', 't9', '旧问题'),
      content: [
        { type: 'text' as const, text: '旧问题' },
        { type: 'image' as const, mediaType: 'image/png', data: 'AAAA', name: 'a.png' },
      ],
      mentions: [{ kind: 'session' as const, id: 's', label: '群' }],
    }
    expect(inputOf(withImage)).toEqual({ content: withImage.content, mentions: withImage.mentions })
    expect(editedInput(withImage, '  新问题 ', [])).toEqual({
      content: [{ type: 'text', text: '新问题' }, withImage.content[1]],
      mentions: [],
    })
    expect(editedInput(user('u', 't'), '   ', [])).toBeUndefined()
    expect(editedInput(user('u', 't'), '', [{ kind: 'file', id: '/a', label: 'a' }])).toEqual({
      content: [{ type: 'text', text: '' }],
      mentions: [{ kind: 'file', id: '/a', label: 'a' }],
    })
  })
})
