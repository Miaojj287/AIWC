// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelationshipProfile } from '@aiwc/protocol'
import { ProfileEditor } from './ProfileEditor'

const profile = (patch: Partial<RelationshipProfile> = {}): RelationshipProfile => ({
  contactId: 'wxid_a',
  displayName: '小明',
  card: { tone: [], traits: [], catchphrases: [], punctuation: '', addressing: {}, topics: [], replyHabits: {} },
  deep: { facts: [], relationship: '', reactionPatterns: [], boundaries: [], sharedEvents: [] },
  samples: [],
  version: 1,
  updatedAt: 0,
  role: 'contact',
  corrections: [],
  ...patch,
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderEditor = (p: RelationshipProfile) => render(<ProfileEditor profile={p} messageCount={undefined} onPatch={async () => {}} onRefine={async () => {}} refining={false} notes={[]} onDeleteNote={async () => {}} />)

describe('ProfileEditor empty states', () => {
  it('renders every empty section with the compact kit EmptyState instead of an inline span', () => {
    renderEditor(profile())
    for (const title of ['暂无语气', '暂无口头禅', '暂无特点', '暂无回复习惯', '暂无纠正', '暂无样本']) {
      const el = screen.getByText(title)
      const root = el.closest('.text-center')
      expect(root, title).not.toBeNull()
      // compact = icon box 36 + title 13; tightened for the 260px column
      expect(root?.className).toContain('py-3')
      expect(root?.querySelector('.size-9')).not.toBeNull()
      expect(root?.querySelector('svg')).not.toBeNull()
    }
    expect(screen.getAllByText('点右侧 + 添加')).toHaveLength(4)
    expect(screen.getByText('在试聊里把好的回复保存为样本')).toBeTruthy()
    expect(screen.queryByText('暂无 · 点右侧 + 添加')).toBeNull()
  })

  it('hides the empty state once a section has content', () => {
    renderEditor(profile({ card: { tone: ['温和'], traits: [], catchphrases: [], punctuation: '', addressing: {}, topics: [], replyHabits: { 表情: '常用' } }, samples: [{ prompt: '在吗', reply: '在的' }] }))
    expect(screen.queryByText('暂无语气')).toBeNull()
    expect(screen.queryByText('暂无回复习惯')).toBeNull()
    expect(screen.queryByText('暂无样本')).toBeNull()
    expect(screen.getByText('暂无口头禅')).toBeTruthy()
    expect(screen.getByText('温和')).toBeTruthy()
    expect(screen.getByText('在的')).toBeTruthy()
  })
})
