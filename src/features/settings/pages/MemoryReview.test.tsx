// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiwcBridge, MemoryProposal } from '@aiwc/protocol'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { clearToasts, getToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetMemoryReviewForTests } from '../memoryReviewStore'
import { MemoryReviewSection } from './MemoryReview'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const proposal = (id: string, text: string, over: Partial<MemoryProposal> = {}): MemoryProposal => ({
  id,
  file: 'USER',
  text,
  origin: 'extraction',
  createdAt: Date.now(),
  threadTitle: '周末计划',
  ...over,
})

let items: MemoryProposal[]
let listener: ((payload: { items: MemoryProposal[] }) => void) | undefined
const invoke = vi.fn(async (channel: string, req: unknown): Promise<unknown> => {
  if (channel === 'memoryReview:list') return items
  if (channel === 'memoryReview:accept') {
    const { id } = req as { id: string }
    if (id === 'mp_full') return { ok: false, reason: 'over_count' }
    items = items.filter((p) => p.id !== id)
    listener?.({ items })
    return { ok: true }
  }
  if (channel === 'memoryReview:dismiss') {
    const { ids } = req as { ids: string[] }
    items = items.filter((p) => !ids.includes(p.id))
    listener?.({ items })
    return undefined
  }
  throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
  items = []
  listener = undefined
  invoke.mockClear()
  clearToasts()
  __resetMemoryReviewForTests()
  __setBridgeForTests({
    runtime: 'electron',
    platform: 'darwin',
    invoke,
    on: (channel: string, fn: (p: { items: MemoryProposal[] }) => void) => {
      if (channel === 'memoryReview:changed') listener = fn
      return () => {}
    },
  } as unknown as AiwcBridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('MemoryReviewSection', () => {
  it('says what turns proposals on when the list is empty', async () => {
    render(<MemoryReviewSection autoWrite={false} />)
    expect(await screen.findByText('没有待确认的记忆')).toBeTruthy()
    expect(screen.getByText(/开启下方「自动写入记忆」/)).toBeTruthy()
  })

  it('writes a proposal, shows provenance, and drops it from the list', async () => {
    items = [proposal('mp_aaaaaaaa', '用户周末喜欢爬山')]
    render(<MemoryReviewSection autoWrite />)
    expect(await screen.findByText('用户周末喜欢爬山')).toBeTruthy()
    expect(screen.getByText(/对话提炼 · 来自「周末计划」/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '写入' }))
    await waitFor(() => expect(screen.getByText('没有待确认的记忆')).toBeTruthy())
    expect(invoke).toHaveBeenCalledWith('memoryReview:accept', { id: 'mp_aaaaaaaa' })
    expect(getToasts().map((t) => t.text)).toContain('已写入 USER.md')
  })

  it('edits text and target file before writing; a refused write stays with an inline reason', async () => {
    items = [proposal('mp_bbbbbbbb', '用户在杭州'), proposal('mp_full', '用户有只猫', { createdAt: 1 })]
    render(<MemoryReviewSection autoWrite />)
    await screen.findByText('用户在杭州')
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '用户住在杭州西湖区' } })
    fireEvent.click(screen.getByRole('radio', { name: 'MEMORY.md' }))
    fireEvent.click(screen.getAllByRole('button', { name: '写入' })[0] as HTMLElement)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('memoryReview:accept', {
        id: 'mp_bbbbbbbb',
        text: '用户住在杭州西湖区',
        file: 'MEMORY',
      }),
    )
    await waitFor(() => expect(screen.queryByText('用户在杭州')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '写入' }))
    expect(await screen.findByText(/USER.md 已达条数上限/)).toBeTruthy()
    expect(screen.getByText('用户有只猫')).toBeTruthy()
  })

  it('dismisses all after confirmation', async () => {
    items = [proposal('mp_cccccccc', '一'), proposal('mp_dddddddd', '二')]
    render(<MemoryReviewSection autoWrite />)
    await screen.findByText('一')
    fireEvent.click(screen.getByRole('button', { name: '全部忽略' }))
    const dialog = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(
        [...dialog.querySelectorAll('button')].find((b) => b.textContent === '全部忽略') as HTMLButtonElement,
      )
    })
    await waitFor(() => expect(screen.getByText('没有待确认的记忆')).toBeTruthy())
    expect(invoke).toHaveBeenCalledWith('memoryReview:dismiss', { ids: ['mp_cccccccc', 'mp_dddddddd'] })
  })
})
