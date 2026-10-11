// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asThreadId, type SkillSummary, type ThreadSummary } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { clearToasts, getToasts } from '@/kit'
import { prefillSaveAsSkill } from './saveAsSkill'
import { parseLocalCommand, runLocalCommand, slashMenuItems, type LocalCommandSurface } from './slashCommands'
import { activeThreadMenu, threadRowMenu } from './threadMenus'

const id = asThreadId('thr_1')
const thread = { threadId: id, title: '周报', pinned: false } as unknown as ThreadSummary

function fakeSurface(opts: { local?: boolean; active?: boolean } = {}) {
  const drafts: Record<string, { text: string }> = { [id]: { text: '' } }
  const state = {
    drafts,
    collapsed: false,
    setDraft: vi.fn((key: string, patch: { text: string }) => {
      drafts[key] = { ...drafts[key], ...patch }
    }),
    newThread: vi.fn(async () => asThreadId('thr_new')),
    openThread: vi.fn(),
    requestFocus: vi.fn(),
  }
  const setDialog = vi.fn()
  const surface = {
    active: opts.active === false ? undefined : thread,
    localIds: opts.local ? [id] : [],
    draftKey: id,
    store: () => state,
    setDialog,
  } as unknown as LocalCommandSurface
  return { surface, state, setDialog }
}

beforeEach(() => clearToasts())
afterEach(() => clearToasts())

describe('local slash commands', () => {
  it('parses only the local commands', () => {
    expect(parseLocalCommand('/compact 保留报价')).toEqual({ command: 'compact', args: '保留报价' })
    expect(parseLocalCommand('/new')).toEqual({ command: 'new', args: '' })
    expect(parseLocalCommand('/周报 产品群')).toBeUndefined()
    expect(parseLocalCommand('请 /compact')).toBeUndefined()
  })

  it('puts local commands first in the / menu and drops skills they shadow', () => {
    const skills: SkillSummary[] = [
      { name: 'weekly', description: '周报', command: '/周报', source: 'builtin' },
      { name: 'compact', description: '同名技能', command: '/compact', source: 'user' },
    ]
    const items = slashMenuItems(skills, t)
    expect(items.map((s) => s.command)).toEqual(['/compact', '/new', '/export', '/clear', '/周报'])
    expect(items[0]!.description).toBe(t('agent.slash.compact'))
  })

  it('/compact opens the compact confirmation with the focus note; ordinary text is not handled', () => {
    const { surface, state, setDialog } = fakeSurface()
    expect(runLocalCommand(surface, '/周报 产品群')).toBe(false)
    expect(runLocalCommand(surface, '你好')).toBe(false)
    expect(setDialog).not.toHaveBeenCalled()
    expect(runLocalCommand(surface, '/compact 保留报价')).toBe(true)
    expect(setDialog).toHaveBeenCalledWith({ kind: 'compact', threadId: id, instructions: '保留报价' })
    expect(state.setDraft).toHaveBeenCalledWith(id, { text: '' })
    runLocalCommand(surface, '/export')
    expect(setDialog).toHaveBeenLastCalledWith({ kind: 'export', threadId: id })
    runLocalCommand(surface, '/clear')
    expect(setDialog).toHaveBeenLastCalledWith({ kind: 'clear', threadId: id })
  })

  it('a thread without history has nothing to compact; /new opens a thread with the rest as its draft', async () => {
    const { surface, state, setDialog } = fakeSurface({ local: true })
    expect(runLocalCommand(surface, '/compact')).toBe(true)
    expect(setDialog).not.toHaveBeenCalled()
    expect(getToasts().map((x) => x.text)).toContain(t('agent.slash.nothingYet'))
    expect(runLocalCommand(surface, '/new 帮我整理周报')).toBe(true)
    await vi.waitFor(() => expect(state.setDraft).toHaveBeenCalledWith('thr_new', { text: '帮我整理周报' }))
    expect(state.newThread).toHaveBeenCalledTimes(1)
  })
})

describe('存为技能…', () => {
  it('is in the active-thread menu and every row menu, enabled only with history', () => {
    const onAction = vi.fn()
    const handlers = { onAction, onPin: vi.fn() }
    const active = activeThreadMenu(t, thread, true, handlers)
    const item = active.find((e) => 'id' in e && e.id === 'saveSkill')
    expect(item && 'disabled' in item && item.disabled).toBe(false)
    if (item && 'onSelect' in item) item.onSelect?.()
    expect(onAction).toHaveBeenCalledWith('saveSkill', id)
    const draft = activeThreadMenu(t, thread, false, handlers).find((e) => 'id' in e && e.id === 'saveSkill')
    expect(draft && 'disabled' in draft && draft.disabled).toBe(true)
    const row = threadRowMenu(t, { thread, saved: true, ...handlers }).find((e) => 'id' in e && e.id === 'saveSkill')
    expect(row).toBeDefined()
  })

  it('fills the composer without sending, after any unsent draft, and expands a collapsed panel', () => {
    const { state } = fakeSurface()
    state.drafts[id] = { text: '先说一句' }
    state.collapsed = true
    const toggled = vi.fn()
    const off = onCommand('agent.toggleCollapsed', toggled)
    const store = (() => state) as unknown as Parameters<typeof prefillSaveAsSkill>[0]
    prefillSaveAsSkill(store, id)
    off()
    expect(state.openThread).toHaveBeenCalledWith(id, { activate: true })
    expect(state.drafts[id]!.text).toBe(`先说一句\n\n${t('agent.thread.saveAsSkillPrompt')}`)
    expect(state.requestFocus).toHaveBeenCalled()
    expect(toggled).toHaveBeenCalled()
    // a second click does not add the request twice
    prefillSaveAsSkill(store, id)
    expect(state.drafts[id]!.text.split(t('agent.thread.saveAsSkillPrompt'))).toHaveLength(2)
  })
})
