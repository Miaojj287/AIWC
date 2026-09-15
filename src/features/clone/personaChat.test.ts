import { describe, expect, it } from 'vitest'
import {
  asThreadId,
  type Event,
  type HistoryItem,
  type ItemId,
  type StepId,
  type ThreadId,
  type TurnId,
} from '@aiwc/protocol'
import {
  contentText,
  initialPersonaChat,
  messagesFromHistory,
  personaChatReducer,
  type PersonaChatState,
} from './personaChat'

const thread = asThreadId('thr_test')
const other = asThreadId('thr_other')
const turn = 'trn_1' as TurnId
const step = 'stp_1' as StepId
const iid = (s: string) => s as ItemId

const ev = (state: PersonaChatState, event: Event, now = 1000) =>
  personaChatReducer(state, { type: 'event', event, now })

describe('personaChatReducer', () => {
  const start = (id: ThreadId = thread) => personaChatReducer(initialPersonaChat, { type: 'thread', threadId: id })

  it('sends optimistically and reconciles with item.user', () => {
    let s = personaChatReducer(start(), { type: 'send', localId: 'local_1', text: '明天路演准备得怎么样', at: 1 })
    expect(s.generating).toBe(true)
    expect(s.messages[0]).toMatchObject({ id: 'local_1', pending: true, role: 'user' })
    s = ev(s, {
      type: 'item.user',
      threadId: thread,
      turnId: turn,
      itemId: iid('itm_u1'),
      content: [{ type: 'text', text: '明天路演准备得怎么样' }],
      mentions: [],
    })
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0]).toMatchObject({ id: 'itm_u1', pending: false })
  })

  it('streams assistant text and finishes on turn.completed', () => {
    let s = start()
    s = ev(s, { type: 'text.start', threadId: thread, turnId: turn, itemId: iid('itm_a1') })
    s = ev(s, { type: 'text.delta', threadId: thread, turnId: turn, itemId: iid('itm_a1'), delta: '哈哈' })
    s = ev(s, { type: 'text.delta', threadId: thread, turnId: turn, itemId: iid('itm_a1'), delta: '差不多啦' })
    expect(s.messages[0]).toMatchObject({ role: 'assistant', text: '哈哈差不多啦', streaming: true })
    s = ev(s, { type: 'text.end', threadId: thread, turnId: turn, itemId: iid('itm_a1'), text: '哈哈 差不多啦' })
    s = ev(s, {
      type: 'turn.completed',
      threadId: thread,
      turnId: turn,
      finalText: '哈哈 差不多啦',
      usage: { inputTokens: 1, outputTokens: 1 },
      steps: 1,
      at: 2,
    })
    expect(s.generating).toBe(false)
    expect(s.messages[0]).toMatchObject({ text: '哈哈 差不多啦', streaming: false })
  })

  it('tolerates deltas without a start and ignores other threads', () => {
    let s = start()
    s = ev(s, { type: 'text.delta', threadId: thread, turnId: turn, itemId: iid('itm_x'), delta: 'ok' })
    expect(s.messages).toHaveLength(1)
    const before = s
    s = ev(s, { type: 'text.delta', threadId: other, turnId: turn, itemId: iid('itm_y'), delta: 'nope' })
    expect(s).toBe(before)
    expect(ev(initialPersonaChat, { type: 'turn.started', threadId: thread, turnId: turn, at: 1 })).toBe(
      initialPersonaChat,
    )
  })

  it('records errors and aborts, clears the transcript', () => {
    let s = personaChatReducer(start(), { type: 'send', localId: 'l', text: 'hi', at: 1 })
    s = ev(s, {
      type: 'error',
      threadId: thread,
      turnId: turn,
      error: { code: 'auth', message: 'Key 无效', retryable: false },
      actions: [],
    })
    expect(s.generating).toBe(false)
    expect(s.error).toBe('Key 无效')
    s = ev(s, { type: 'text.start', threadId: thread, turnId: turn, itemId: iid('a') })
    s = ev(s, { type: 'turn.aborted', threadId: thread, turnId: turn, reason: 'interrupted' })
    expect(s.messages.every((m) => !m.streaming)).toBe(true)
    expect(personaChatReducer(s, { type: 'clear' }).messages).toEqual([])
  })

  it('drops the optimistic bubble of a send that never reached the kernel', () => {
    let s = personaChatReducer(start(), { type: 'send', localId: 'l1', text: '在吗', at: 1 })
    s = personaChatReducer(s, { type: 'send', localId: 'l2', text: '周末有空吗', at: 2 })
    s = personaChatReducer(s, { type: 'error', message: '网络错误', localId: 'l2' })
    expect(s.error).toBe('网络错误')
    expect(s.messages.map((m) => m.id)).toEqual(['l1'])
    expect(personaChatReducer(s, { type: 'error', message: 'x' }).messages).toHaveLength(1)
  })

  it('a turn error drops user bubbles the kernel never recorded; a later item.user brings them back', () => {
    let s = personaChatReducer(start(), { type: 'send', localId: 'l1', text: '早', at: 1 })
    s = ev(s, {
      type: 'item.user',
      threadId: thread,
      turnId: turn,
      itemId: iid('itm_u1'),
      content: [{ type: 'text', text: '早' }],
      mentions: [],
    })
    s = personaChatReducer(s, { type: 'send', localId: 'l2', text: '吃了吗', at: 2 })
    s = ev(s, {
      type: 'error',
      threadId: thread,
      turnId: turn,
      error: { code: 'auth', message: '未配置模型', retryable: false },
      actions: [],
    })
    expect(s.messages.map((m) => m.id)).toEqual(['itm_u1'])
    s = ev(s, {
      type: 'item.user',
      threadId: thread,
      turnId: turn,
      itemId: iid('itm_u2'),
      content: [{ type: 'text', text: '吃了吗' }],
      mentions: [],
    })
    expect(s.messages.map((m) => [m.id, m.text])).toEqual([
      ['itm_u1', '早'],
      ['itm_u2', '吃了吗'],
    ])
  })

  it('converts history items, skipping internal ones', () => {
    const items: HistoryItem[] = [
      {
        type: 'context_fragment',
        id: iid('c'),
        turnId: null,
        createdAt: 1,
        kind: 'memory',
        marker: '<m>',
        text: 'x',
        tokenEstimate: 1,
      },
      {
        type: 'user_message',
        id: iid('u'),
        turnId: turn,
        createdAt: 2,
        content: [
          { type: 'text', text: '你好' },
          { type: 'image', mediaType: 'image/png', data: '' },
        ],
        mentions: [],
      },
      { type: 'assistant_message', id: iid('a'), turnId: turn, stepId: step, createdAt: 3, text: '嗯' },
    ]
    expect(messagesFromHistory(items)).toEqual([
      { id: 'u', role: 'user', text: '你好\n[图片]', at: 2 },
      { id: 'a', role: 'assistant', text: '嗯', at: 3 },
    ])
    expect(contentText([{ type: 'file', mediaType: 'text/plain', data: '', name: 'a.txt' }])).toBe('[a.txt]')
  })
})
