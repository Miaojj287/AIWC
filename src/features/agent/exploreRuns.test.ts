import { describe, expect, it } from 'vitest'
import type { CallId, TurnId } from '@aiwc/protocol'
import { groupWork } from './exploreRuns'
import type { ThreadItem, ToolCallView } from './model'

const turnId = 'trn_1' as TurnId
const call = (id: string, over: Partial<ToolCallView> = {}): ToolCallView => ({
  callId: id as CallId,
  toolName: 'search_messages',
  summary: id,
  status: 'done',
  risk: 'read',
  input: null,
  startedAt: 0,
  ...over,
})
const tools = (id: string, ...calls: ToolCallView[]): ThreadItem => ({ kind: 'tools', id, turnId, calls })
const thought = (id: string): ThreadItem => ({
  kind: 'assistant',
  id,
  turnId,
  text: '',
  reasoning: '想一想',
  streaming: false,
})
const reply = (id: string): ThreadItem => ({ kind: 'assistant', id, turnId, text: '好的', streaming: false })

const shape = (items: ThreadItem[]) =>
  groupWork(items).map((e) =>
    e.kind === 'explore'
      ? `explore(${e.members.map((m) => (m.kind === 'call' ? m.call.callId : `~${m.item.id}`)).join(',')})`
      : e.item.kind === 'tools'
        ? `tools(${e.item.calls.map((c) => c.callId).join(',')})`
        : e.item.id,
  )

describe('groupWork', () => {
  it('folds two or more read-only calls, also across the thinking between steps', () => {
    expect(shape([tools('g1', call('a')), thought('r1'), tools('g2', call('b')), thought('r2')])).toEqual([
      'explore(a,~r1,b)',
      'r2',
    ])
  })

  it('keeps a lone read, a write and anything with a reply in between as rows', () => {
    expect(shape([tools('g1', call('a'), call('w', { risk: 'write' }), call('b'))])).toEqual(['tools(a,w,b)'])
    expect(shape([tools('g1', call('a')), reply('t'), tools('g2', call('b'))])).toEqual(['tools(a)', 't', 'tools(b)'])
  })

  it('splits a mixed group around its run of reads', () => {
    expect(
      shape([tools('g1', call('w', { risk: 'write' }), call('a'), call('b'), call('x', { risk: 'send' }))]),
    ).toEqual(['tools(w)', 'explore(a,b)', 'tools(x)'])
  })

  it('never folds rows that wait for the user, run sub-agents, or stand for the plan', () => {
    expect(
      shape([
        tools(
          'g1',
          call('a', { status: 'awaiting_approval' }),
          call('d', { children: [{ childId: 'c', label: 'x', status: 'running', items: [] }] }),
          call('p', { toolName: 'update_plan' }),
          call('b'),
        ),
      ]),
    ).toEqual(['tools(a,d,b)'])
  })
})
