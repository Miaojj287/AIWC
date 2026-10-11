import { afterEach, describe, expect, it } from 'vitest'
import type { Event, ThreadId, TurnId } from '@aiwc/protocol'
import { t } from '@/i18n'
import {
  attentionCount,
  attentionFor,
  attentionIndicator,
  noteThreadAttention,
  useThreadAttention,
} from './threadAttention'

const a = 'thr_a' as ThreadId
const b = 'thr_b' as ThreadId
const turnId = 'trn_1' as TurnId
const completed = (threadId: ThreadId): Event => ({
  type: 'turn.completed',
  threadId,
  turnId,
  finalText: 'x',
  usage: { inputTokens: 0, outputTokens: 0 },
  steps: 1,
  at: 1,
})
const aborted = (threadId: ThreadId, reason: 'error' | 'interrupted'): Event => ({
  type: 'turn.aborted',
  threadId,
  turnId,
  reason,
})

afterEach(() => {
  useThreadAttention.setState({ marks: {}, viewing: null })
  localStorage.clear()
})

describe('thread attention', () => {
  it('maps turn endings to marks; a stop by the user marks nothing', () => {
    expect(attentionFor(completed(a))).toBe('unread')
    expect(attentionFor(aborted(a, 'error'))).toBe('failed')
    expect(attentionFor(aborted(a, 'interrupted'))).toBeUndefined()
  })

  it('marks desktop threads finished out of sight, keeps a failure, and clears on viewing', () => {
    useThreadAttention.getState().setViewing(a)
    noteThreadAttention(completed(a), 'desktop')
    noteThreadAttention(aborted(b, 'error'), 'desktop')
    noteThreadAttention(completed(b), 'desktop')
    noteThreadAttention(completed('thr_cron' as ThreadId), 'cron')
    expect(useThreadAttention.getState().marks).toEqual({ [b]: 'failed' })
    expect(attentionCount(useThreadAttention.getState().marks, [{ threadId: a }, { threadId: b }])).toBe(1)
    // a deleted thread's mark never reaches the badge
    expect(attentionCount(useThreadAttention.getState().marks, [{ threadId: a }])).toBe(0)
    expect(JSON.parse(localStorage.getItem('aiwc.agent.attention') ?? '{}')).toEqual({ [b]: 'failed' })

    useThreadAttention.getState().setViewing(b)
    expect(useThreadAttention.getState().marks).toEqual({})
  })

  it('words the tab indicator', () => {
    expect(attentionIndicator('failed', t)).toEqual({ tone: 'danger', label: '运行失败' })
    expect(attentionIndicator('unread', t)?.tone).toBe('accent')
    expect(attentionIndicator(undefined, t)).toBeUndefined()
  })
})
