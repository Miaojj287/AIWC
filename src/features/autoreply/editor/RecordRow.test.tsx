// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutoReplyRecord } from '@aiwc/protocol'
import { RecordRow } from './RecordRow'

const record = (patch: Partial<AutoReplyRecord> = {}): AutoReplyRecord => ({
  id: 'rec_1',
  ruleId: 'r1',
  sessionId: 's1',
  triggerMessage: { id: 'evt', localId: 'm1', text: '在吗', senderName: '小吴', at: 1_700_000_000_000 },
  replyText: '在的，怎么了',
  at: 1_700_000_000_000,
  status: 'pending',
  sendMode: 'confirm',
  draftId: 'drf_1',
  ...patch,
})

afterEach(cleanup)

describe('RecordRow', () => {
  it('a parked reply is editable and sent from the row; edits switch the button to 修改后发送', async () => {
    const onDecide = vi.fn(async () => {})
    render(<RecordRow record={record()} now={1_700_000_000_000} onDecide={onDecide} onView={() => {}} primary />)
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    await waitFor(() =>
      expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec_1' }), 'approve', undefined),
    )
    fireEvent.change(screen.getByRole('textbox', { name: '待确认的回复' }), { target: { value: '在的，晚点说' } })
    expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '修改后发送' }))
    await waitFor(() => expect(onDecide).toHaveBeenLastCalledWith(expect.anything(), 'edit', '在的，晚点说'))
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    await waitFor(() => expect(onDecide).toHaveBeenLastCalledWith(expect.anything(), 'reject', undefined))
  })

  it('keeps 查看原消息 inline on a parked row, so hovering never shifts the send button', () => {
    const onView = vi.fn()
    const { container } = render(
      <RecordRow record={record()} now={1_700_000_000_000} onDecide={async () => {}} onView={onView} />,
    )
    // No hover-revealed side column on rows that carry inline buttons.
    expect(container.querySelector('.group-hover\\:flex')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看原消息' }))
    expect(onView).toHaveBeenCalledTimes(1)
  })

  it('a counting-down reply offers 取消发送; a sent one only the hover actions', () => {
    const onDecide = vi.fn(async () => {})
    const { unmount } = render(
      <RecordRow record={record({ sendMode: 'auto' })} now={1_700_000_000_000} onDecide={onDecide} />,
    )
    expect(screen.getByText('即将发送')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消发送' }))
    expect(onDecide).toHaveBeenCalledWith(expect.anything(), 'reject', undefined)
    unmount()
    render(
      <RecordRow record={record({ status: 'sent' })} now={1_700_000_000_000} onDecide={onDecide} onView={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
    expect(screen.getByText('已发送')).toBeTruthy()
  })
})
