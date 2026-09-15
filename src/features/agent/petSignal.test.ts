// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CallId, ThreadId, TurnId } from '@aiwc/protocol'
import { __resetAgentStoreForTests, useAgentStore } from './agentStore'
import { createThreadView, type ThreadItem } from './model'
import {
  __resetPetSignalForTests,
  runningActivity,
  turnOutcome,
  usePetReactionStore,
  watchPetReactions,
} from './petSignal'

const T = 't1' as ThreadId
const turn = (n: number) => `turn_${n}` as TurnId
const user = (n: number): ThreadItem => ({
  kind: 'user',
  id: `u${n}`,
  turnId: turn(n),
  content: [{ type: 'text', text: `q${n}` }],
  mentions: [],
})
const answer = (n: number, text: string): ThreadItem => ({
  kind: 'assistant',
  id: `a${n}`,
  turnId: turn(n),
  text,
  streaming: false,
})

describe('turnOutcome', () => {
  it('reads the latest turn only', () => {
    expect(turnOutcome([])).toBeUndefined()
    expect(turnOutcome([user(1), answer(1, '旧回答'), user(2), answer(2, '新回答')])).toEqual({
      turnId: 'turn_2',
      outcome: 'completed',
      message: '新回答',
    })
    expect(
      turnOutcome([
        user(1),
        { kind: 'error', id: 'e1', turnId: turn(1), error: { code: 'x', message: '旧错误' }, actions: [] },
        user(2),
        answer(2, 'ok'),
      ]),
    ).toMatchObject({ outcome: 'completed' })
  })

  it('treats errors and guard aborts as failures, user stops as interruptions', () => {
    expect(
      turnOutcome([
        user(1),
        { kind: 'error', id: 'e', turnId: turn(1), error: { code: 'auth', message: 'API Key 无效' }, actions: [] },
      ]),
    ).toMatchObject({ outcome: 'failed', message: 'API Key 无效' })
    expect(turnOutcome([user(1), { kind: 'aborted', id: 'x', turnId: turn(1), reason: 'loop_guard' }])).toMatchObject({
      outcome: 'failed',
      message: '检测到重复调用，已停止',
    })
    expect(
      turnOutcome([user(1), answer(1, '半截'), { kind: 'aborted', id: 'x', turnId: turn(1), reason: 'interrupted' }]),
    ).toMatchObject({ outcome: 'interrupted' })
  })
})

describe('runningActivity', () => {
  it('names the tool running in the current turn', () => {
    const tools: ThreadItem = {
      kind: 'tools',
      id: 'g',
      turnId: turn(1),
      calls: [
        {
          callId: 'c1' as CallId,
          toolName: 'search',
          summary: '搜索聊天记录',
          status: 'done',
          risk: 'read',
          input: null,
          startedAt: 0,
        },
        {
          callId: 'c2' as CallId,
          toolName: 'stats',
          summary: '统计消息',
          status: 'running',
          risk: 'read',
          input: null,
          startedAt: 0,
        },
      ],
    }
    expect(runningActivity(createThreadView(T, { isStreaming: true, items: [user(1), tools] }))).toBe('统计消息')
    expect(runningActivity(createThreadView(T, { isStreaming: false, items: [user(1), tools] }))).toBeUndefined()
    expect(runningActivity(createThreadView(T, { isStreaming: true, items: [tools, user(2)] }))).toBeUndefined()
  })
})

describe('watchPetReactions', () => {
  beforeEach(() => {
    __resetAgentStoreForTests()
    __resetPetSignalForTests()
  })
  afterEach(() => __resetPetSignalForTests())

  const setView = (patch: Parameters<typeof createThreadView>[1]) =>
    useAgentStore.setState((s) => ({ views: { ...s.views, [T]: createThreadView(T, { loaded: true, ...patch }) } }))

  it('records a reaction only on a live streaming → idle transition', () => {
    watchPetReactions(() => 42)
    setView({ items: [user(1), answer(1, '历史里的回答')] })
    expect(usePetReactionStore.getState().reactions[T]).toBeUndefined()

    setView({ isStreaming: true, items: [user(2)] })
    setView({ isStreaming: false, items: [user(2), answer(2, '整理好了')] })
    expect(usePetReactionStore.getState().reactions[T]).toEqual({
      key: 't1:turn_2:42',
      outcome: 'completed',
      message: '整理好了',
      at: 42,
    })

    setView({ isStreaming: true, items: [user(3)] })
    setView({
      isStreaming: false,
      items: [user(3), { kind: 'aborted', id: 'x', turnId: turn(3), reason: 'interrupted' }],
    })
    expect(usePetReactionStore.getState().reactions[T]).toBeUndefined()
  })
})
