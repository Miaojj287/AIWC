import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, promises as fsp, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSkillIndex } from '@aiwc/kernel'
import { defaultConfig, type AppConfig, type ConfigPatch, type InvokeChannel } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { HostBridge } from './register'
import { nextDisabledSkills, registerSkillsIpc } from './skills'
import { createHandlerHarness } from './testing/handlerHarness'

let root: string

function writeSkill(dir: string, folder: string, content: string): void {
  mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, folder, 'SKILL.md'), content, 'utf8')
}
const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} 技能\n---\n\n步骤\n`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-skills-ipc-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function setup() {
  const builtin = join(root, 'builtin')
  const user = join(root, 'user')
  writeSkill(builtin, 'weekly', skillMd('weekly'))
  writeSkill(user, 'recap', skillMd('recap'))
  let config: AppConfig = defaultConfig()
  const set = vi.fn((patch: ConfigPatch) => {
    config = { ...config, agent: { ...config.agent, ...patch.agent } }
    return config
  })
  const skills = createSkillIndex({
    dirs: [
      { path: builtin, source: 'builtin' },
      { path: user, source: 'user' },
    ],
    disabled: () => config.agent.disabledSkills,
  })
  await skills.refresh()
  const broadcast = vi.fn()
  const ipc = createHandlerHarness()
  registerSkillsIpc(
    { skills, broadcast, config: { get: () => config, set } } as unknown as AppContext,
    {} as HostBridge,
    ipc.handle,
  )
  const invokeRaw = (channel: InvokeChannel, req: unknown): Promise<unknown> =>
    Promise.resolve().then(() => ipc.invokeRaw(channel, req))
  return { ipc, invokeRaw, skills, broadcast, user, getConfig: () => config }
}

describe('skills IPC', () => {
  it('lists, switches off and back on by name', async () => {
    const { ipc, skills, broadcast, getConfig } = await setup()
    expect((await ipc.invoke('skills:list', undefined)).map((s) => s.id)).toEqual(['user:recap', 'builtin:weekly'])
    await ipc.invoke('skills:setEnabled', { name: 'weekly', enabled: false })
    expect(getConfig().agent.disabledSkills).toEqual(['weekly'])
    expect(skills.list().map((s) => s.name)).toEqual(['recap'])
    expect(broadcast).toHaveBeenCalledWith('skills:changed', { skills: expect.any(Array) })
    await ipc.invoke('skills:setEnabled', { name: 'weekly', enabled: true })
    expect(getConfig().agent.disabledSkills).toEqual([])
  })

  it('validates requests and refuses unknown or built-in skills', async () => {
    const { invokeRaw } = await setup()
    for (const bad of [null, {}, { id: 42 }, { id: 'user:recap', extra: 1 }])
      await expect(invokeRaw('skills:get', bad)).rejects.toThrow(t('main.skills.invalidRequest'))
    await expect(invokeRaw('skills:setEnabled', { name: 'weekly' })).rejects.toThrow(t('main.skills.invalidRequest'))
    await expect(invokeRaw('skills:setEnabled', { name: 'ghost', enabled: false })).rejects.toThrow(
      t('main.skills.notFound'),
    )
    await expect(invokeRaw('skills:get', { id: '../../etc' })).rejects.toThrow(t('main.skills.notFound'))
    await expect(invokeRaw('skills:delete', { id: 'builtin:weekly' })).rejects.toThrow(t('main.skills.builtin'))
  })

  it('returns the detail and deletes a user skill folder, clearing its switch', async () => {
    const { ipc, user, getConfig } = await setup()
    expect(await ipc.invoke('skills:get', { id: 'user:recap' })).toMatchObject({ name: 'recap', body: '步骤' })
    await ipc.invoke('skills:setEnabled', { name: 'recap', enabled: false })
    await ipc.invoke('skills:delete', { id: 'user:recap' })
    await expect(fsp.access(join(user, 'recap'))).rejects.toThrow()
    expect(getConfig().agent.disabledSkills).toEqual([])
  })

  it('nextDisabledSkills toggles one name', () => {
    expect(nextDisabledSkills(['a', 'b'], 'a', true)).toEqual(['b'])
    expect(nextDisabledSkills(['b'], 'a', false)).toEqual(['b', 'a'])
    expect(nextDisabledSkills(['a'], 'a', false)).toEqual(['a'])
  })
})
