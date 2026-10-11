import { describe, expect, it } from 'vitest'
import type { CallId, HistoryItem, ThreadId, TurnId } from '@aiwc/protocol'
import { artifactToOpen, shouldAutoOpen } from './artifactAutoOpen'
import { createThreadView } from './model'
import { viewFromHistory } from './historyItems'

const T = 'trn_1' as TurnId
const thread = 'thr_1' as ThreadId

describe('artifactToOpen', () => {
  it('picks the newest openable file of the turn', () => {
    const view = createThreadView(thread, {
      items: [
        {
          kind: 'artifact',
          id: 'a1',
          turnId: T,
          callId: 'c1' as CallId,
          artifact: { kind: 'file', title: 'a', path: '/a.md' },
        },
        {
          kind: 'artifact',
          id: 'a2',
          turnId: T,
          callId: 'c2' as CallId,
          artifact: { kind: 'file', title: 'b', path: '/b.md' },
        },
        {
          kind: 'artifact',
          id: 'a3',
          turnId: T,
          callId: 'c3' as CallId,
          artifact: { kind: 'markdown', title: 'inline', content: 'x' },
        },
        {
          kind: 'artifact',
          id: 'a4',
          turnId: 'trn_2' as TurnId,
          callId: 'c4' as CallId,
          artifact: { kind: 'file', title: 'c', path: '/c.md' },
        },
      ],
    })
    expect(artifactToOpen(view, T)?.path).toBe('/b.md')
    expect(artifactToOpen(view, 'trn_none' as TurnId)).toBeUndefined()
  })
})

describe('shouldAutoOpen', () => {
  const base = { threadId: thread, activeThreadId: thread, collapsed: false, channel: 'desktop' as const }
  it('only for the desktop thread on screen', () => {
    expect(shouldAutoOpen(base)).toBe(true)
    expect(shouldAutoOpen({ ...base, collapsed: true })).toBe(false)
    expect(shouldAutoOpen({ ...base, activeThreadId: 'thr_other' as ThreadId })).toBe(false)
    expect(shouldAutoOpen({ ...base, channel: 'cron' })).toBe(false)
    expect(shouldAutoOpen({ ...base, channel: undefined })).toBe(false)
  })
})

describe('history replay', () => {
  it('rebuilds the cards of files a tool produced, after its tool row', () => {
    const history: HistoryItem[] = [
      {
        type: 'tool_call',
        id: 'i1' as never,
        turnId: T,
        stepId: 's' as never,
        createdAt: 1,
        callId: 'c1' as CallId,
        toolName: 'shell',
        input: {},
      },
      {
        type: 'tool_result',
        id: 'i2' as never,
        turnId: T,
        stepId: 's' as never,
        createdAt: 2,
        callId: 'c1' as CallId,
        toolName: 'shell',
        output: { type: 'text', text: 'ok' },
        isError: false,
        durationMs: 1,
        truncated: false,
        artifacts: [
          { kind: 'file', title: '周报.md', path: '/ws/周报.md' },
          // a damaged line cannot crash the transcript
          { kind: 'file', title: 7 as never, path: undefined },
        ],
      },
    ]
    const view = viewFromHistory(thread, history)
    expect(view.items.map((it) => it.kind)).toEqual(['tools', 'artifact'])
    expect(view.items[1]).toMatchObject({ artifact: { title: '周报.md', path: '/ws/周报.md' } })
  })
})
