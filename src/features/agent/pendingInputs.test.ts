import { describe, expect, it } from 'vitest'
import type { CallId, TurnId } from '@aiwc/protocol'
import { createThreadView, type PendingInput, type ThreadItem } from './model'
import {
  addPendingInput,
  placePendingInputs,
  sendModeFor,
  unansweredPrompt,
  withoutPendingInput,
} from './pendingInputs'
import { reduceEvent } from './reducer'
import { buildTimeline } from './turnSegments'

const T1 = 'trn_1' as TurnId
const T2 = 'trn_2' as TurnId
const AT = Date.UTC(2026, 9, 10, 9)

const pending = (id: string, mode: PendingInput['mode'], text = id): PendingInput => ({
  clientInputId: id,
  content: [{ type: 'text', text }],
  mentions: [],
  mode,
  createdAt: AT,
})

const user = (id: string, turnId: TurnId): ThreadItem => ({
  kind: 'user',
  id,
  turnId,
  content: [{ type: 'text', text: id }],
  mentions: [],
  createdAt: AT,
})
const reply = (id: string, turnId: TurnId, text = '好的'): ThreadItem => ({
  kind: 'assistant',
  id,
  turnId,
  text,
  streaming: false,
  createdAt: AT,
})
const tools = (id: string, turnId: TurnId): ThreadItem => ({
  kind: 'tools',
  id,
  turnId,
  calls: [
    {
      callId: 'cal_1' as CallId,
      toolName: 'search_messages',
      summary: '检索',
      status: 'running',
      risk: 'read',
      input: null,
      startedAt: AT,
    },
  ],
})

describe('send mode', () => {
  it('steers while a turn runs or is still starting, starts otherwise', () => {
    const idle = createThreadView('thr_1' as never, { loaded: true })
    expect(sendModeFor(idle)).toBe('start')
    expect(sendModeFor({ ...idle, isStreaming: true })).toBe('steer')
    // the first prompt was sent but its turn has not reported back yet
    expect(sendModeFor(addPendingInput(idle, pending('a', 'start')))).toBe('steer')
    expect(sendModeFor(undefined)).toBe('start')
  })
})

describe('withoutPendingInput', () => {
  it('drops the input with that id and keeps the same array otherwise', () => {
    const list = [pending('a', 'steer'), pending('b', 'steer')]
    expect(withoutPendingInput(list, 'a')).toEqual([pending('b', 'steer')])
    expect(withoutPendingInput(list, 'zzz')).toBe(list)
    expect(withoutPendingInput(list, undefined)).toBe(list)
    expect(withoutPendingInput([pending('a', 'steer')], 'a')).toBeUndefined()
  })

  it('is applied by the reducer when item.user echoes the id', () => {
    const view = addPendingInput(
      { ...createThreadView('thr_1' as never, { loaded: true }), isStreaming: true, currentTurnId: T1 },
      pending('cin_a', 'steer', '顺便列出谁@了我'),
    )
    const next = reduceEvent(view, {
      type: 'item.user',
      threadId: 'thr_1' as never,
      turnId: T1,
      itemId: 'itm_9' as never,
      content: [{ type: 'text', text: '顺便列出谁@了我' }],
      mentions: [],
      clientInputId: 'cin_a',
    })
    expect(next.pendingInputs).toBeUndefined()
    expect(next.items.at(-1)).toMatchObject({ kind: 'user', id: 'itm_9' })
    // an input recorded without the id (another surface sent it) leaves pending ones alone
    const other = reduceEvent(view, {
      type: 'item.user',
      threadId: 'thr_1' as never,
      turnId: T1,
      itemId: 'itm_10' as never,
      content: [{ type: 'text', text: 'x' }],
      mentions: [],
    })
    expect(other.pendingInputs).toHaveLength(1)
  })
})

describe('placePendingInputs', () => {
  it('lists steers after the transcript so the running turn stays open', () => {
    const items = [user('u1', T1), tools('t1', T1)]
    const timeline = buildTimeline(items, { streaming: true, activeTurnId: T1 })
    const placed = placePendingInputs(timeline, [pending('s', 'steer')])
    expect(placed.timeline).toBe(timeline)
    expect(placed.trailing.map((p) => p.clientInputId)).toEqual(['s'])
    const last = placed.timeline.at(-1)
    expect(last?.kind === 'segment' && last.segment.status).toBe('running')
  })

  it('makes a starting prompt the prompt of the running placeholder turn', () => {
    const items = [user('u1', T1), reply('a1', T1)]
    const timeline = buildTimeline(items, { streaming: true, activeTurnId: T2, turnStartedAt: AT })
    const placed = placePendingInputs(timeline, [pending('p', 'start', '再查一次')])
    const last = placed.timeline.at(-1)
    expect(last?.kind).toBe('segment')
    if (last?.kind !== 'segment') return
    expect(last.segment.status).toBe('running')
    expect(last.segment.user?.content).toEqual([{ type: 'text', text: '再查一次' }])
    expect(last.segment.turnId).toBe(T2)
    expect(placed.timeline).toHaveLength(timeline.length)
  })

  it('opens a running segment for a prompt whose turn has not started yet', () => {
    const items = [user('u1', T1), reply('a1', T1)]
    const timeline = buildTimeline(items, { streaming: false })
    const placed = placePendingInputs(timeline, [pending('p', 'start')])
    expect(placed.timeline).toHaveLength(timeline.length + 1)
    const last = placed.timeline.at(-1)
    expect(last?.kind === 'segment' && last.segment.status).toBe('running')
    expect(placed.trailing).toEqual([])
  })
})

describe('unansweredPrompt', () => {
  it('finds a last prompt nothing answered', () => {
    expect(unansweredPrompt([user('u1', T1), reply('a1', T1), user('u2', T2)])).toMatchObject({ id: 'u2' })
    // an empty streaming placeholder is not an answer
    expect(unansweredPrompt([user('u1', T1), reply('a1', T1, '')])).toMatchObject({ id: 'u1' })
  })

  it('is undefined once anything answered, failed or stopped the prompt', () => {
    expect(unansweredPrompt([])).toBeUndefined()
    expect(unansweredPrompt([user('u1', T1), reply('a1', T1)])).toBeUndefined()
    expect(unansweredPrompt([user('u1', T1), tools('t1', T1)])).toBeUndefined()
    expect(unansweredPrompt([user('u1', T1), { kind: 'aborted', id: 'x', turnId: T1, reason: 'interrupted' }])).toBe(
      undefined,
    )
    expect(
      unansweredPrompt([
        user('u1', T1),
        { kind: 'error', id: 'e', turnId: T1, error: { code: 'x', message: 'x' }, actions: [] },
      ]),
    ).toBeUndefined()
  })
})
