/**
 * pet:* — AI 宠物. The catalog and downloads go to codex-pets.net only; imports come from a zip the
 * user picks in the system dialog (the path never comes from the renderer). Installs report their
 * steps on 'pet:installStep' and can be cancelled while downloading.
 */
import { dialog } from 'electron'
import { isValidPetId } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

export function registerPetIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const running = new Map<string, AbortController>()

  handle('pet:list', () => ctx.pets.listInstalled())

  handle('pet:catalog', (query) => ctx.pets.catalog(query ?? {}))

  handle('pet:install', async ({ id }) => {
    if (!isValidPetId(id)) throw new Error(t('main.pets.invalidId'))
    if (running.has(id)) throw new Error(t('main.pets.alreadyInstalling'))
    const controller = new AbortController()
    running.set(id, controller)
    try {
      const pet = await ctx.pets.install(id, {
        signal: controller.signal,
        onStep: (step, status, detail) => ctx.broadcast('pet:installStep', { id, step, status, detail }),
      })
      ctx.broadcast('pet:changed', { reason: 'installed', id: pet.id })
      return pet
    } finally {
      running.delete(id)
    }
  })

  handle('pet:cancelInstall', ({ id }) => {
    running.get(id)?.abort()
  })

  handle('pet:import', async () => {
    const win = host.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: t('main.pets.importDialogTitle'),
      buttonLabel: t('main.pets.importDialogButton'),
      properties: ['openFile'],
      filters: [{ name: t('main.pets.importFilter'), extensions: ['zip'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = result.canceled ? undefined : result.filePaths[0]
    if (!file) return null
    const pet = await ctx.pets.importZip(file)
    ctx.broadcast('pet:changed', { reason: 'imported', id: pet.id })
    return pet
  })

  handle('pet:remove', async ({ id }) => {
    await ctx.pets.remove(id)
    // A removed pet can no longer be the current one. `set` skips undefined values, so clear the field
    // with a validated replace; the renderer re-reads the config and falls back to the bundled pet.
    const cfg = ctx.config.get()
    if (cfg.pet.current === id) ctx.config.replace({ ...cfg, pet: { ...cfg.pet, current: undefined } })
    ctx.broadcast('pet:changed', { reason: 'removed', id })
  })
}
