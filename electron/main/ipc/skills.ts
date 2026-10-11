/**
 * skills:* — 设置 › 技能. Renderer input is untrusted: requests are validated with the protocol schemas, a skill is
 * addressed by the id the index handed out (never by a path), and deletion goes through the index, which refuses
 * built-in skills and anything that resolves outside its skills folder.
 */
import { SkillIdRequestSchema, SkillSetEnabledRequestSchema } from '@aiwc/protocol'
import { SkillOpError } from '@aiwc/kernel'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

/** UI copy for a refused operation; anything else is rethrown as is. */
function skillError(e: unknown): Error {
  if (e instanceof SkillOpError) {
    switch (e.code) {
      case 'not_found':
        return new Error(t('main.skills.notFound'), { cause: e })
      case 'builtin':
        return new Error(t('main.skills.builtin'), { cause: e })
      case 'outside_root':
        return new Error(t('main.skills.outsideRoot'), { cause: e })
    }
  }
  return e instanceof Error ? e : new Error(String(e))
}

/** `disabled` with `name` switched on or off; unchanged entries keep their order. */
export function nextDisabledSkills(disabled: readonly string[], name: string, enabled: boolean): string[] {
  const rest = disabled.filter((n) => n !== name)
  return enabled ? rest : [...rest, name]
}

export function registerSkillsIpc(
  ctx: Pick<AppContext, 'skills' | 'config' | 'broadcast'>,
  _host: HostBridge,
  handle: Handle,
): void {
  const { skills, config } = ctx
  const pushList = () => ctx.broadcast('skills:changed', { skills: skills.entries() })

  // Rescan on every list: skills edited by hand in the folder show up without restarting.
  handle('skills:list', async () => {
    await skills.refresh()
    return skills.entries()
  })

  handle('skills:get', async (req) => {
    const parsed = SkillIdRequestSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('main.skills.invalidRequest'))
    try {
      return await skills.detail(parsed.data.id)
    } catch (e) {
      throw skillError(e)
    }
  })

  handle('skills:setEnabled', (req) => {
    const parsed = SkillSetEnabledRequestSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('main.skills.invalidRequest'))
    const { name, enabled } = parsed.data
    if (!skills.entries().some((e) => e.name === name)) throw new Error(t('main.skills.notFound'))
    const current = config.get().agent.disabledSkills
    config.set({ agent: { disabledSkills: nextDisabledSkills(current, name, enabled) } })
    pushList()
  })

  handle('skills:delete', async (req) => {
    const parsed = SkillIdRequestSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('main.skills.invalidRequest'))
    const target = skills.entries().find((e) => e.id === parsed.data.id)
    try {
      await skills.remove(parsed.data.id)
    } catch (e) {
      throw skillError(e)
    }
    // A skill created again later under the same name should not come back switched off.
    const name = target?.name
    const disabled = config.get().agent.disabledSkills
    if (name && disabled.includes(name) && !skills.entries().some((e) => e.name === name)) {
      config.set({ agent: { disabledSkills: nextDisabledSkills(disabled, name, true) } })
      pushList()
    }
  })
}
