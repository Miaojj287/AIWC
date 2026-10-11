import { describe, expect, it } from 'vitest'
import type { CallId, StepId, TurnId } from '@aiwc/protocol'
import { outcomeToResultItem } from './toolExec'

const ids = { turnId: 'trn_1' as TurnId, stepId: 'stp_1' as StepId }

describe('outcomeToResultItem', () => {
  it('keeps generated files by path so the transcript can offer them after a reload', () => {
    const item = outcomeToResultItem(
      {
        callId: 'cal_1' as CallId,
        toolName: 'shell',
        result: { content: { ok: true } },
        isError: false,
        status: 'done',
        durationMs: 12,
        artifacts: [
          { kind: 'file', title: '周报.md', path: '/ws/周报.md', mediaType: 'text/markdown' },
          { kind: 'markdown', title: '内联', content: '# 很长的正文' },
        ],
      },
      ids,
      100,
    )
    expect(item.artifacts).toEqual([
      { kind: 'file', title: '周报.md', path: '/ws/周报.md', mediaType: 'text/markdown' },
    ])
    expect(JSON.stringify(item)).not.toContain('很长的正文')
  })

  it('records no artifacts field when the call produced none', () => {
    const item = outcomeToResultItem(
      {
        callId: 'cal_2' as CallId,
        toolName: 'echo',
        result: { content: 'x' },
        isError: false,
        status: 'done',
        durationMs: 1,
      },
      ids,
      100,
    )
    expect('artifacts' in item).toBe(false)
  })
})
