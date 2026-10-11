// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CallId, JsonValue, ThreadId, WorkflowRunView } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { createThreadView, type ToolCallView } from '../model'
import { reduceEvent } from '../reducer'
import { WorkflowCard } from './WorkflowCard'

afterEach(() => {
  cleanup()
  __resetLanguageForTests()
})

const view = (status: WorkflowRunView['status'], steps: WorkflowRunView['steps']): JsonValue =>
  ({ kind: 'workflow', title: 'Plan', status, steps }) as unknown as JsonValue

const call = (patch: Partial<ToolCallView>): ToolCallView => ({
  callId: 'c1' as CallId,
  toolName: 'workflow_run',
  summary: 'Plan',
  status: 'running',
  risk: 'read',
  input: null,
  startedAt: 0,
  ...patch,
})

describe('WorkflowCard', () => {
  it('lists the live steps from the progress detail', () => {
    render(
      <WorkflowCard
        call={call({
          progressDetail: view('running', [
            { id: 'a', title: '收集消息', mode: 'read', status: 'done', durationMs: 3200 },
            { id: 'b', title: '写周报', mode: 'write', status: 'running' },
            { id: 'c', title: '推送', mode: 'write', status: 'pending', dependsOn: ['b'] },
          ]),
        })}
      />,
    )
    expect(screen.getByText('1/3 步完成')).toBeTruthy()
    expect(screen.getByText('写周报')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getAllByText('可写入')).toHaveLength(2)
  })

  it('prefers the recorded output and names why a step stopped (English)', () => {
    setLanguage('en-US')
    render(
      <WorkflowCard
        call={call({
          status: 'done',
          output: view('partial', [
            { id: 'a', title: 'Collect', mode: 'read', status: 'failed', error: 'invalid_json' },
            { id: 'b', title: 'Write', mode: 'write', status: 'skipped', error: 'dependency_failed' },
          ]),
        })}
      />,
    )
    expect(screen.getByText('No valid JSON')).toBeTruthy()
    expect(screen.getByText('An earlier step did not finish')).toBeTruthy()
    expect(screen.getByText('0/2 steps done')).toBeTruthy()
  })

  it('the reducer keeps the latest progress detail on the call', () => {
    const base = reduceEvent(createThreadView('thr_1' as ThreadId), {
      type: 'tool.call',
      threadId: 'thr_1' as never,
      turnId: 'trn_1' as never,
      stepId: 'stp_1' as never,
      callId: 'c1' as CallId,
      toolName: 'workflow_run',
      summary: 'Plan',
      input: null,
      status: 'running',
      risk: 'read',
      startedAt: 0,
    })
    const detail = view('running', [])
    const next = reduceEvent(base, {
      type: 'tool.progress',
      threadId: 'thr_1' as never,
      callId: 'c1' as CallId,
      message: 'x',
      detail,
    })
    const tools = next.items.find((i) => i.kind === 'tools')
    expect(tools?.kind === 'tools' && tools.calls[0]?.progressDetail).toEqual(detail)
  })
})
