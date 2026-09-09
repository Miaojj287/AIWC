// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { getTabRegistration, type TabKind } from '@/workspace/tabRegistry'
import { TAB_FUNCTION } from '@/workspace/tabsStore'
import { registerFeatures } from './registerFeatures'
import { descriptorFor } from './tabCommands'

vi.mock('@/features/replydesk/store', () => ({ startReplyDesk: vi.fn().mockResolvedValue(undefined), useReplyDeskCount: () => 0 }))

/*
 * ⌘⇧K (web mode) ends in tabsStore.open({ kind: 'kit' }); the Workspace then needs a renderer for that
 * kind or it shows the「无法显示此标签」error state. Guard that the bootstrap registers one for every
 * kind a tab.open* command can produce.
 */
describe('registerFeatures', () => {
  it('registers a renderer for every tab kind, including the kit gallery opened by ⌘⇧K', () => {
    registerFeatures()
    registerFeatures() // idempotent
    const kit = descriptorFor('tab.openKit', undefined)
    expect(kit).toMatchObject({ kind: 'kit', objectId: 'gallery' })
    expect(getTabRegistration('kit')?.icon).toBe('palette')
    for (const kind of Object.keys(TAB_FUNCTION) as TabKind[]) expect(getTabRegistration(kind), kind).toBeDefined()
  })
})
