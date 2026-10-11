// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApprovalId, CallId, TurnId } from '@aiwc/protocol'
import type { ApprovalRequest, ThreadItem } from './model'
import { TurnAnnouncer } from './TurnAnnouncer'

afterEach(cleanup)

const turnId = 'trn_1' as TurnId
const answer: ThreadItem = { kind: 'assistant', id: 'a1', turnId, text: '好的', streaming: false }
const approval: ApprovalRequest = {
  approvalId: 'apr_1' as ApprovalId,
  callId: 'c1' as CallId,
  turnId,
  toolName: 'send_message',
  summary: '推送到 投研交流群',
  input: {},
  risk: 'send',
  canAllowAlways: false,
}

const region = () => screen.getByRole('status')

describe('<TurnAnnouncer>', () => {
  it('is silent on mount and while the answer streams, then says once that the turn ended', () => {
    const { rerender } = render(<TurnAnnouncer streaming={false} items={[answer]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('')
    rerender(<TurnAnnouncer streaming items={[answer]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('')
    rerender(<TurnAnnouncer streaming={false} items={[answer]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('Agent 已回复完毕')
    // the next turn clears it, so the same sentence is a change (and is announced) again
    rerender(<TurnAnnouncer streaming items={[answer]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('')
  })

  it('announces a pending approval with its summary and falls silent once it is resolved', () => {
    const { rerender } = render(<TurnAnnouncer streaming items={[]} pendingApprovals={[]} />)
    rerender(<TurnAnnouncer streaming items={[]} pendingApprovals={[approval]} />)
    expect(region().textContent).toBe('Agent 需要你确认：推送到 投研交流群')
    rerender(<TurnAnnouncer streaming items={[]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('')
  })

  it('says why a turn stopped early and leaves errors to the error card alert', () => {
    const aborted: ThreadItem = { kind: 'aborted', id: 'ab1', turnId, reason: 'interrupted' }
    const failed: ThreadItem = {
      kind: 'error',
      id: 'e1',
      turnId,
      error: { code: 'network', message: 'offline', retryable: true },
      actions: [],
    }
    const { rerender } = render(<TurnAnnouncer streaming items={[answer]} pendingApprovals={[]} />)
    rerender(<TurnAnnouncer streaming={false} items={[answer, aborted]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('已停止生成')
    rerender(<TurnAnnouncer streaming items={[answer]} pendingApprovals={[]} />)
    rerender(<TurnAnnouncer streaming={false} items={[answer, failed]} pendingApprovals={[]} />)
    expect(region().textContent).toBe('')
  })
})
