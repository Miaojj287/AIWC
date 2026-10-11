import { afterEach, describe, expect, it } from 'vitest'
import type { CallId, TurnId } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import type { ThreadItem } from './model'
import { answerReplies, buildTimeline, formatWorkDuration, messageTimeLabel, type TurnSegment } from './turnSegments'

afterEach(() => __resetLanguageForTests())

const T1 = 'trn_1' as TurnId
const T2 = 'trn_2' as TurnId
const AT = Date.UTC(2026, 8, 27, 10, 0, 0)

const user = (id: string, turnId: TurnId, createdAt = AT): ThreadItem => ({
  kind: 'user',
  id,
  turnId,
  content: [{ type: 'text', text: id }],
  mentions: [],
  createdAt,
})
const reply = (id: string, turnId: TurnId, text: string, extra: Partial<ThreadItem> = {}): ThreadItem =>
  ({ kind: 'assistant', id, turnId, text, streaming: false, ...extra }) as ThreadItem
const tools = (id: string, turnId: TurnId, startedAt: number, durationMs: number): ThreadItem => ({
  kind: 'tools',
  id,
  turnId,
  calls: [
    {
      callId: `${id}_c` as CallId,
      toolName: 'search',
      summary: id,
      status: 'done',
      risk: 'read',
      input: null,
      startedAt,
      durationMs,
    },
  ],
})

const segments = (entries: ReturnType<typeof buildTimeline>): TurnSegment[] =>
  entries.flatMap((e) => (e.kind === 'segment' ? [e.segment] : []))

describe('buildTimeline', () => {
  it('opens a segment per prompt and folds the work before a finished turn’s final answer', () => {
    const items = [
      user('u1', T1),
      reply('a1', T1, 'Checking first.'),
      tools('t1', T1, AT + 1000, 2000),
      reply('a2', T1, 'Here is the answer.', { createdAt: AT + 80_000 }),
      user('u2', T2, AT + 90_000),
    ]
    const [first, second] = segments(buildTimeline(items, { streaming: false }))
    expect(first?.body.map((it) => it.id)).toEqual(['a1', 't1', 'a2'])
    expect(first?.status).toBe('done')
    expect(first?.answerStart).toBe(2)
    expect(first?.foldable).toBe(true)
    expect(first?.startedAt).toBe(AT)
    expect(first?.endedAt).toBe(AT + 80_000)
    expect(second?.user?.id).toBe('u2')
    expect(second?.body).toEqual([])
  })

  it('keeps every reply after the last tool call in the answer — a trailing 更正 never hides the answer', () => {
    const items = [
      user('u1', T1),
      reply('interim', T1, 'Let me search.'),
      tools('t1', T1, AT + 1000, 2000),
      reply('answer', T1, 'Here is the full answer.', { reasoning: 'Summarize.' } as Partial<ThreadItem>),
      reply('fix', T1, '更正：the second quote is from another message.', {
        reasoning: 'Audit.',
      } as Partial<ThreadItem>),
    ]
    const [seg] = segments(buildTimeline(items, { streaming: false }))
    expect(seg?.answerStart).toBe(2)
    expect(seg?.foldable).toBe(true)
    expect(seg && answerReplies(seg).map((it) => it.id)).toEqual(['answer', 'fix'])
  })

  it('starts the answer after a revision, so the superseded draft folds into the work', () => {
    const items: ThreadItem[] = [
      user('u1', T1),
      tools('t1', T1, AT, 10),
      reply('draft', T1, 'Draft with a bad quote.'),
      { kind: 'revision', id: 'rev', turnId: T1 },
      reply('final', T1, 'Rewritten answer.'),
    ]
    const [seg] = segments(buildTimeline(items, { streaming: false }))
    expect(seg?.answerStart).toBe(3)
    expect(seg && answerReplies(seg).map((it) => it.id)).toEqual(['final'])
  })

  it('has no answer when the turn ended on tool calls, so nothing folds', () => {
    const items = [user('u1', T1), reply('interim', T1, 'Searching.'), tools('t1', T1, AT, 10)]
    const [seg] = segments(buildTimeline(items, { streaming: false }))
    expect(seg?.answerStart).toBeUndefined()
    expect(seg?.foldable).toBe(false)
  })

  it('never folds a running turn, a stopped or failed one, or a lone answer without work', () => {
    const running = segments(
      buildTimeline([user('u1', T1), tools('t1', T1, AT, 10), reply('a1', T1, 'Partial')], {
        streaming: true,
        activeTurnId: T1,
      }),
    )[0]
    expect(running?.status).toBe('running')
    expect(running?.foldable).toBe(false)
    expect(running?.answerStart).toBeUndefined()

    const stopped = segments(
      buildTimeline(
        [
          user('u1', T1),
          tools('t1', T1, AT, 10),
          reply('a1', T1, 'Partial'),
          { kind: 'aborted', id: 'x', turnId: T1, reason: 'interrupted' },
        ],
        { streaming: false },
      ),
    )[0]
    expect(stopped?.status).toBe('stopped')
    expect(stopped?.foldable).toBe(false)

    const lone = segments(buildTimeline([user('u1', T1), reply('a1', T1, 'Hi')], { streaming: false }))[0]
    expect(lone?.foldable).toBe(false)
    const reasoned = segments(
      buildTimeline([user('u1', T1), reply('a1', T1, 'Hi', { reasoning: 'Think' } as Partial<ThreadItem>)], {
        streaming: false,
      }),
    )[0]
    expect(reasoned?.foldable).toBe(true)
  })

  it('splits items of another turn without a prompt, and never folds a segment that has no prompt', () => {
    const entries = buildTimeline(
      [reply('a1', T1, 'First'), tools('t1', T1, AT, 10), reply('a2', T1, 'Second'), reply('b1', T2, 'Other turn')],
      { streaming: false },
    )
    const [first, second] = segments(entries)
    expect(first?.body.map((it) => it.id)).toEqual(['a1', 't1', 'a2'])
    expect(first?.foldable).toBe(false)
    expect(second?.body.map((it) => it.id)).toEqual(['b1'])
  })

  it('keeps compaction markers between segments and adds a pending segment for a turn with nothing visible yet', () => {
    const entries = buildTimeline([user('u1', T1), reply('a1', T1, 'Done'), { kind: 'compaction', id: 'c1' }], {
      streaming: true,
      activeTurnId: T2,
      turnStartedAt: AT + 5000,
    })
    expect(entries.map((e) => e.kind)).toEqual(['segment', 'standalone', 'segment'])
    const [done, pending] = segments(entries)
    expect(done?.status).toBe('done')
    expect(pending).toMatchObject({ status: 'running', body: [], startedAt: AT + 5000 })
  })

  it('treats a steer mid-turn as its own segment', () => {
    const [before, after] = segments(
      buildTimeline([user('u1', T1), reply('a1', T1, 'Working on it'), user('u2', T1), tools('t1', T1, AT, 5)], {
        streaming: true,
        activeTurnId: T1,
      }),
    )
    expect(before?.status).toBe('done')
    expect(after?.user?.id).toBe('u2')
    expect(after?.status).toBe('running')
  })

  it('ignores timestamps that are not wall-clock times', () => {
    const [seg] = segments(buildTimeline([user('u1', T1, 0), tools('t1', T1, 0, 800)], { streaming: false }))
    expect(seg?.startedAt).toBeUndefined()
    expect(seg?.endedAt).toBeUndefined()
  })
})

describe('formatWorkDuration', () => {
  it('uses at most two units and drops a zero second unit', () => {
    expect(formatWorkDuration(12_400)).toBe('12 秒')
    expect(formatWorkDuration(80_000)).toBe('1 分 20 秒')
    expect(formatWorkDuration(8 * 60_000)).toBe('8 分')
    expect(formatWorkDuration(3_900_000)).toBe('1 小时 5 分')
    expect(formatWorkDuration(3_600_000)).toBe('1 小时')
    setLanguage('en-US')
    expect(formatWorkDuration(80_000)).toBe('1m 20s')
  })
})

describe('messageTimeLabel', () => {
  it('shows the clock today, 昨天 before it, and the date further back', () => {
    const now = new Date(2026, 8, 27, 15, 0).getTime()
    expect(messageTimeLabel(new Date(2026, 8, 27, 9, 5).getTime(), now)).toBe('09:05')
    expect(messageTimeLabel(new Date(2026, 8, 26, 21, 30).getTime(), now)).toBe('昨天 21:30')
    expect(messageTimeLabel(new Date(2026, 1, 3, 8, 0).getTime(), now)).toBe('2/3 08:00')
    expect(messageTimeLabel(new Date(2025, 11, 31, 8, 0).getTime(), now)).toBe('2025/12/31 08:00')
    expect(messageTimeLabel(undefined, now)).toBe('')
  })
})
