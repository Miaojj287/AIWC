import { describe, expect, it, vi } from 'vitest'
import type { WxSession } from '@aiwc/protocol'
import { applyClientFilters, buildSessionRows, segmentKind, servableAvatar, sessionMenuSpec, sessionSubtitle } from './sessionListModel'

const base: WxSession = { id: 'wxid_a', kind: 'dm', title: '张明', unread: 3, pinned: false, muted: false, lastPreview: '好的，明天见', lastSender: '张明' }
const group: WxSession = { ...base, id: 'g@chatroom', kind: 'group', title: '产品市场群', memberCount: 18, lastSender: '李明', lastPreview: '周会纪要已上传' }

describe('sessionListModel', () => {
  it('maps segments to query kinds', () => {
    expect(segmentKind(null)).toBe('all')
    expect(segmentKind('all')).toBe('all')
    expect(segmentKind('dm')).toBe('dm')
    expect(segmentKind('group')).toBe('group')
    expect(segmentKind('bogus')).toBe('all')
  })

  it('prefixes group previews with the sender and leaves DMs alone', () => {
    expect(sessionSubtitle(group)).toBe('李明：周会纪要已上传')
    expect(sessionSubtitle(base)).toBe('好的，明天见')
    expect(sessionSubtitle({ ...group, lastPreview: undefined })).toBe('')
  })

  it('applies the muted filter client-side', () => {
    const items = [base, { ...base, id: 'b', muted: true }]
    expect(applyClientFilters(items, {})).toHaveLength(2)
    expect(applyClientFilters(items, { mutedOnly: true }).map((s) => s.id)).toEqual(['b'])
  })

  it('groups real official accounts, collapsed chats and pins; search reveals matches', () => {
    const official = { ...base, id: 'gh_news', kind: 'official' as const, lastMessageAt: 20 }
    const folded = { ...group, collapsed: true, lastMessageAt: 10 }
    const input = [base, official, folded]
    const rows = buildSessionRows(input, new Set())
    expect(rows.map((s) => s.id)).toEqual(['ui-folder:official', 'ui-folder:collapsed', base.id])
    expect(rows[0]).toMatchObject({ unread: 3, count: 1 })
    expect(buildSessionRows(input, new Set(['official'])).map((s) => s.id)).toContain('gh_news')
    expect(buildSessionRows(input, new Set(), true)).toHaveLength(3)
    expect(buildSessionRows([], new Set())).toEqual([])
    expect(buildSessionRows([{ ...base, pinned: true }], new Set(['pinned']))).toHaveLength(2)
  })

  it('only serves avatar URLs the renderer can load', () => {
    expect(servableAvatar('/Users/me/Library/avatar.jpg')).toBe('aiwc-media:///Users/me/Library/avatar.jpg')
    expect(servableAvatar('aiwc-media://avatar/abc')).toBe('aiwc-media://avatar/abc')
    expect(servableAvatar('data:image/png;base64,AAAA')).toBeTruthy()
    expect(servableAvatar(undefined)).toBeUndefined()
  })

  it('builds the menu in the mandated order with the danger item last', () => {
    const actions = { setFlags: vi.fn(), openAutoReply: vi.fn(), openClone: vi.fn(), quoteToAgent: vi.fn(), hide: vi.fn(), unhide: vi.fn() }
    const spec = sessionMenuSpec(base, actions, { mac: true })
    const labels = spec.map((it) => (it.type === 'separator' ? '—' : 'label' in it ? String(it.label) : '?'))
    expect(labels).toEqual(['置顶会话', '标为已读', '静音通知', '—', '设置自动回复', '克隆此联系人', '引用到 Agent', '—', '从列表隐藏'])
    const last = spec[spec.length - 1]
    expect(last && 'danger' in last && last.danger).toBe(true)
    const quote = spec.find((it) => 'id' in it && it.id === 'quote')
    expect(quote).toMatchObject({ shortcut: '⌘⇧A' })

    const pin = spec[0]
    if (pin && 'onSelect' in pin) pin.onSelect?.()
    expect(actions.setFlags).toHaveBeenCalledWith({ pinned: true })
  })

  it('flips labels for pinned / muted sessions, disables clone for groups and read when nothing is unread', () => {
    const actions = { setFlags: vi.fn(), openAutoReply: vi.fn(), openClone: vi.fn(), quoteToAgent: vi.fn(), hide: vi.fn(), unhide: vi.fn() }
    const spec = sessionMenuSpec({ ...group, pinned: true, muted: true, unread: 0 }, actions, { mac: false })
    const byId = (id: string) => spec.find((it) => 'id' in it && it.id === id)
    expect(byId('pin')).toMatchObject({ label: '取消置顶' })
    expect(byId('mute')).toMatchObject({ label: '取消静音' })
    expect(byId('read')).toMatchObject({ disabled: true })
    expect(byId('clone')).toMatchObject({ disabled: true })
    expect(byId('quote')).toMatchObject({ shortcut: 'Ctrl+Shift+A' })
  })

  it('offers 恢复到列表 instead of hiding when browsing hidden sessions', () => {
    const actions = { setFlags: vi.fn(), openAutoReply: vi.fn(), openClone: vi.fn(), quoteToAgent: vi.fn(), hide: vi.fn(), unhide: vi.fn() }
    const spec = sessionMenuSpec(base, actions, { mac: true, hidden: true })
    const last = spec[spec.length - 1]
    expect(last).toMatchObject({ id: 'unhide', label: '恢复到列表' })
    expect(last && 'danger' in last && last.danger).toBeFalsy()
  })
})
