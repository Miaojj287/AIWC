// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CallId } from '@aiwc/protocol'
import type { ToolCallView } from '../model'
import { TaskToolCard, taskFromToolOutput } from './TaskToolCard'

const { runCommandMock } = vi.hoisted(() => ({ runCommandMock: vi.fn() }))
vi.mock('@/app/commands', () => ({ runCommand: runCommandMock }))

afterEach(cleanup)

const call = (output: ToolCallView['output'], status: ToolCallView['status'] = 'done'): ToolCallView => ({
  callId: 'cal_1' as CallId,
  toolName: 'task_create',
  summary: '创建定时任务：开会',
  status,
  risk: 'write',
  input: {},
  output,
  startedAt: 0,
})

describe('task tool result card', () => {
  it('reads only the created / updated shape', () => {
    expect(
      taskFromToolOutput({ created: { id: 't1', name: '开会', enabled: true, next_run_ms: 5, action: 'remind' } }),
    ).toEqual({ id: 't1', name: '开会', enabled: true, nextRunMs: 5, remind: true })
    expect(taskFromToolOutput('ok')).toBeUndefined()
    expect(taskFromToolOutput({ deleted: { id: 't1' } })).toBeUndefined()
  })

  it('links to the task editor once the call is done', () => {
    const output = { created: { id: 't1', name: '开会', enabled: true, next_run_ms: null, action: 'agent' } }
    const { container } = render(<TaskToolCard call={call(output, 'running')} />)
    expect(container.textContent).toBe('')
    cleanup()
    render(<TaskToolCard call={call(output)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开任务' }))
    expect(runCommandMock).toHaveBeenCalledWith('tab.openTask', { id: 't1', title: '开会' })
  })
})
