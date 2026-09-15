// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryItem, ItemId, RelationshipProfile, StepId, ThreadSummary, TurnId } from '@aiwc/protocol'
import { clearToasts, getToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge, type MockBridge } from '@/platform/mockBridge'
import { ReadyView } from './ReadyView'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const REPLY = '好啊，明天见'
const HISTORY: HistoryItem[] = [
  {
    type: 'assistant_message',
    id: 'itm_a1' as ItemId,
    turnId: 'trn_1' as TurnId,
    stepId: 'stp_1' as StepId,
    createdAt: 1_700_000_000_000,
    text: REPLY,
  },
]
const PROFILE: RelationshipProfile = {
  contactId: 'wxid_friend',
  displayName: 'Friend',
  card: { tone: [], traits: [], catchphrases: [], punctuation: '', addressing: {}, topics: [], replyHabits: {} },
  deep: { facts: [], relationship: '', reactionPatterns: [], boundaries: [], sharedEvents: [] },
  samples: [],
  version: 1,
  updatedAt: 0,
  role: 'contact',
  corrections: [],
}

const nativeScrollIntoView = Element.prototype.scrollIntoView
let bridge: MockBridge

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.scrollIntoView = () => {}
  clearToasts()
  bridge = createMockBridge({ timeScale: 0, storage: null, onboarding: false })
  bridge.handlers['clone:get'] = () => PROFILE
  bridge.handlers['clone:notes'] = () => []
  bridge.handlers['agent:getThread'] = () => ({ summary: {} as ThreadSummary, items: HISTORY })
  __setBridgeForTests(bridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = nativeScrollIntoView
  clearToasts()
})

const renderReady = () =>
  render(
    <ReadyView
      contactId="wxid_friend"
      name="Friend"
      status={{ state: 'ready', version: 1, sampleCount: 0, builtAt: 1_700_000_000_000 }}
      messageCount={undefined}
      threadId="thr_persona"
      onThreadId={() => {}}
      onReclone={async () => {}}
      onDeleted={() => {}}
    />,
  )

/** Waits for the profile column, then clicks 保存为样本 on the clone's reply. */
async function saveReplyAsSample(): Promise<void> {
  await screen.findByText(REPLY)
  await screen.findByText('人格画像')
  fireEvent.click(screen.getByRole('button', { name: '保存为样本' }))
}

const toastTexts = () => getToasts().map((t) => `${t.kind}:${t.text}`)

describe('ReadyView 保存为样本', () => {
  it('a failed save shows its error toast only — never 已保存为样本 as well', async () => {
    bridge.handlers['clone:updateProfile'] = () => {
      throw new Error('磁盘已满')
    }
    renderReady()
    await saveReplyAsSample()

    await waitFor(() => expect(toastTexts()).toContain('error:更新画像失败'))
    expect(toastTexts()).toEqual(['error:更新画像失败'])
  })

  it('a successful save shows exactly one 已保存为样本', async () => {
    const patches: unknown[] = []
    bridge.handlers['clone:updateProfile'] = ({ patch }) => {
      patches.push(patch)
      return { ...PROFILE, ...patch }
    }
    renderReady()
    await saveReplyAsSample()

    await waitFor(() => expect(toastTexts()).toEqual(['success:已保存为样本']))
    expect(patches).toHaveLength(1)
  })
})
