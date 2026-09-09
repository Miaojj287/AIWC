import type { AppContext } from '../contracts'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import type { Handle, HostBridge } from './register'

export function registerConfigIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  handle('config:get', () => ctx.config.get())
  handle('config:set', (patch) => {
    // account.cacheDir feeds the substrate's media cache; it is NOT allowed to widen the file
    // allow-list, so it must already be allowed (picked via dialog this session / under the data root).
    const cacheDir = customCacheDir(patch.account?.cacheDir)
    if (cacheDir) {
      const verdict = validateCacheDir(cacheDir, { allowList: ctx.allowList })
      if (!verdict.ok) throw new Error(verdict.reason)
    }
    return ctx.config.set(patch)
  })

  handle('secret:set', ({ ref, value }) => {
    if (typeof value !== 'string' || value.length === 0) throw new Error('密钥不能为空')
    ctx.secrets.set(ref, value)
  })
  handle('secret:has', ({ ref }) => ctx.secrets.has(ref))
  handle('secret:reveal', ({ ref }) => ctx.secrets.reveal(ref))
  handle('secret:delete', ({ ref }) => ctx.secrets.delete(ref))
}
