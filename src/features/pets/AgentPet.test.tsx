// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type InstalledPet, type PetConfig } from '@aiwc/protocol'
import { AgentPet } from './AgentPet'
import type { AgentPetSignal } from './petModel'

const pet: InstalledPet = {
  id: 'aiwcji',
  displayName: 'AIWC 鸡',
  description: '',
  builtin: true,
  source: 'builtin',
  spriteVersion: 1,
  spriteUrl: 'aiwc-media:///pets/aiwcji/spritesheet.webp',
}
const config = (patch: Partial<PetConfig> = {}): PetConfig => ({ ...defaultConfig().pet, ...patch })
const idle: AgentPetSignal = { threadId: 't1', streaming: false }

function mount(
  signal: AgentPetSignal,
  patch: Partial<PetConfig> = {},
  props: Partial<Parameters<typeof AgentPet>[0]> = {},
) {
  const onOpenSettings = vi.fn()
  const view = render(
    <AgentPet pet={pet} config={config(patch)} signal={signal} onOpenSettings={onOpenSettings} {...props} />,
  )
  const rerender = (next: AgentPetSignal, nextPatch: Partial<PetConfig> = patch) =>
    view.rerender(
      <AgentPet pet={pet} config={config(nextPatch)} signal={next} onOpenSettings={onOpenSettings} {...props} />,
    )
  return { ...view, rerender, onOpenSettings }
}

const petButton = () => screen.getByRole('button', { name: /^AIWC 鸡：/ })
const sprite = () => petButton().querySelector('[data-animation]') as HTMLElement

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('<AgentPet>', () => {
  it('waits with a 需要你确认 bubble while an approval is open and runs while the Agent works', () => {
    const { rerender } = mount({ ...idle, streaming: true, approval: '发送「明天见」给 张三' })
    expect(petButton().dataset.mood).toBe('waiting')
    expect(sprite().dataset.animation).toBe('waiting')
    expect(screen.getByText('需要你确认')).toBeTruthy()
    expect(screen.getByText('发送「明天见」给 张三')).toBeTruthy()

    rerender({ ...idle, streaming: true })
    expect(petButton().dataset.mood).toBe('running')
    expect(sprite().dataset.animation).toBe('running')
    expect(screen.queryByText('需要你确认')).toBeNull()
  })

  it('celebrates a finished turn, then settles back to idle when the window passes', () => {
    const now = Date.now()
    mount({ ...idle, reaction: { key: 'r1', outcome: 'completed', message: '周报整理好了', at: now } })
    expect(petButton().dataset.mood).toBe('review')
    expect(sprite().dataset.animation).toBe('review')
    expect(screen.getByText('完成了')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(9_000)
    })
    expect(petButton().dataset.mood).toBe('idle')
    expect(screen.queryByText('完成了')).toBeNull()
  })

  it('hides bubbles when turned off and lets the user dismiss one', () => {
    const failed = {
      ...idle,
      reaction: { key: 'r2', outcome: 'failed' as const, message: 'API Key 无效', at: Date.now() },
    }
    const { unmount } = mount(failed, { bubbles: false })
    expect(petButton().dataset.mood).toBe('failed')
    expect(screen.queryByText('出错了')).toBeNull()
    unmount()

    mount(failed)
    fireEvent.click(screen.getByText('出错了'))
    expect(screen.queryByText('出错了')).toBeNull()
  })

  it('hops when poked, and holds a still first frame with motion off', () => {
    const { rerender } = mount(idle)
    fireEvent.click(petButton())
    expect(sprite().dataset.animation).toBe('jumping')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(sprite().dataset.animation).toBe('idle')

    rerender({ ...idle, streaming: true }, { motion: false })
    expect(sprite().dataset.animation).toBe('running')
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(sprite().dataset.frame).toBe('0')
  })

  it('in the collapsed strip it has no bubble and expands the panel on click', () => {
    const onActivate = vi.fn()
    mount({ ...idle, approval: '删除规则' }, {}, { variant: 'mini', onActivate })
    expect(screen.getByTestId('agent-pet-mini')).toBeTruthy()
    expect(screen.queryByText('需要你确认')).toBeNull()
    fireEvent.click(petButton())
    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})
