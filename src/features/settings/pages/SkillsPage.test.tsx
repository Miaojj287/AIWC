// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiwcBridge, SkillEntry } from '@aiwc/protocol'
import { onCommand } from '@/app/commands'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { clearToasts, getToasts } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetSkillsForTests } from '@/platform/skills'
import { SkillsPage } from './SkillsPage'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)

const skill = (over: Partial<SkillEntry> & Pick<SkillEntry, 'id' | 'name'>): SkillEntry => ({
  description: `${over.name} 的说明`,
  command: `/${over.name}`,
  source: 'user',
  enabled: true,
  usable: true,
  diagnostics: [],
  params: [],
  tags: [],
  size: 100,
  deletable: true,
  ...over,
})

let skills: SkillEntry[]
let listener: ((payload: { skills: SkillEntry[] }) => void) | undefined
const invoke = vi.fn(async (channel: string, req: unknown): Promise<unknown> => {
  if (channel === 'skills:list') return skills
  if (channel === 'skills:setEnabled') {
    const { name, enabled } = req as { name: string; enabled: boolean }
    skills = skills.map((s) => (s.name === name ? { ...s, enabled } : s))
    listener?.({ skills })
    return undefined
  }
  if (channel === 'skills:delete') {
    const { id } = req as { id: string }
    skills = skills.filter((s) => s.id !== id)
    listener?.({ skills })
    return undefined
  }
  if (channel === 'skills:get') {
    const found = skills.find((s) => s.id === (req as { id: string }).id)!
    return { ...found, body: '# 步骤\n\n先这样再那样', path: '/skills/x/SKILL.md', truncated: false }
  }
  throw new Error(`unexpected ${channel}`)
})

beforeEach(() => {
  skills = []
  listener = undefined
  invoke.mockClear()
  clearToasts()
  __resetSkillsForTests()
  __setBridgeForTests({
    runtime: 'electron',
    platform: 'darwin',
    invoke,
    on: (channel: string, fn: (p: { skills: SkillEntry[] }) => void) => {
      if (channel === 'skills:changed') listener = fn
      return () => {}
    },
  } as unknown as AiwcBridge)
})

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

describe('SkillsPage', () => {
  it('shows the empty state with how to make a skill', async () => {
    render(<SkillsPage />)
    expect(await screen.findByText('还没有技能')).toBeTruthy()
  })

  it('lists broken skills with the reason and lets a healthy one be switched off', async () => {
    skills = [
      skill({ id: 'builtin:weekly', name: 'weekly', source: 'builtin', deletable: false }),
      skill({ id: 'user:bad', name: 'bad', usable: false, diagnostics: ['invalid_frontmatter'] }),
    ]
    render(<SkillsPage />)
    expect(await screen.findByText('/weekly')).toBeTruthy()
    expect(screen.getByText('无法加载')).toBeTruthy()
    expect(screen.getByText('frontmatter 不是有效的 YAML')).toBeTruthy()
    expect((screen.getByRole('switch', { name: '启用技能 bad' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('switch', { name: '启用技能 weekly' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('skills:setEnabled', { name: 'weekly', enabled: false }))
    expect(await screen.findByText('已停用')).toBeTruthy()
    expect(getToasts().map((t) => t.text)).toContain('已停用技能「weekly」')
  })

  it('filters by source and search', async () => {
    skills = [
      skill({ id: 'builtin:weekly', name: 'weekly', source: 'builtin', deletable: false }),
      skill({ id: 'user:recap', name: 'recap', source: 'agent' }),
    ]
    render(<SkillsPage />)
    await screen.findByText('/weekly')
    fireEvent.click(screen.getByRole('radio', { name: 'Agent 创建' }))
    expect(screen.queryByText('/weekly')).toBeNull()
    expect(screen.getByText('/recap')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '全部' }))
    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的技能')).toBeTruthy()
  })

  it('views a skill, schedules it as a task, and deletes after confirmation', async () => {
    skills = [
      skill({
        id: 'user:recap',
        name: 'recap',
        source: 'agent',
        params: [{ name: 'chat', description: '哪个群', required: true }],
      }),
    ]
    const opened = vi.fn()
    const off = onCommand('tab.openTask', opened)
    render(<SkillsPage />)
    await screen.findByText('/recap')

    fireEvent.contextMenu(screen.getByText('/recap'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '查看' }))
    const viewer = await screen.findByRole('dialog')
    expect(await within(viewer).findByText('先这样再那样')).toBeTruthy()
    expect(within(viewer).getByText('哪个群')).toBeTruthy()
    fireEvent.click(within(viewer).getByRole('button', { name: '设为定时任务…' }))
    expect(opened).toHaveBeenCalledWith({ id: 'new', title: 'recap', name: 'recap', prompt: '/recap chat=' })
    off()

    fireEvent.contextMenu(screen.getByText('/recap'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除…' }))
    const confirm = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: '删除' }))
    })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('skills:delete', { id: 'user:recap' }))
    expect(await screen.findByText('还没有技能')).toBeTruthy()
  })
})
