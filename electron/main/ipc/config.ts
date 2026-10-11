import { accountProfileId } from '../services/accountProfiles'
import type { AppContext } from '../contracts'
import { customCacheDir, validateCacheDir } from '../security/cacheDirPolicy'
import { isRendererSecretRef, isRevealableSecretRef, refusedSecretRefInPatch } from '../security/secretRefPolicy'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

/** The renderer may only name secrets it manages (security/secretRefPolicy.ts); main-only refs are refused. */
function rendererRef(ref: unknown, allowed: (ref: unknown) => ref is string): string {
  if (!allowed(ref)) throw new Error(t('main.config.secretRefRefused', { ref: String(ref).slice(0, 128) }))
  return ref
}

export function registerConfigIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  handle('config:get', () => ctx.config.get())
  handle('config:set', (patch) => {
    if (
      ctx.paths.accountScope &&
      patch.account?.wxid !== undefined &&
      accountProfileId(patch.account.wxid ?? undefined) !== ctx.paths.accountScope
    )
      throw new Error(t('main.substrate.accountMismatch'))
    const refused = refusedSecretRefInPatch(patch)
    if (refused !== undefined) throw new Error(t('main.config.secretRefRefused', { ref: refused }))
    // account.cacheDir feeds the substrate's media cache; it is NOT allowed to widen the file
    // allow-list, so it must already be allowed (picked via dialog this session / under the data root) or unchanged.
    const cacheDir = customCacheDir(patch.account?.cacheDir)
    if (cacheDir) {
      const saved = customCacheDir(ctx.config.get().account.cacheDir)
      const verdict = validateCacheDir(cacheDir, { allowList: ctx.allowList, saved })
      if (!verdict.ok) throw new Error(verdict.reason)
    }
    return ctx.config.set(patch)
  })

  handle('secret:set', ({ ref, value }) => {
    const target = rendererRef(ref, isRendererSecretRef)
    if (typeof value !== 'string' || value.length === 0) throw new Error(t('main.config.secretEmpty'))
    ctx.secrets.set(target, value)
  })
  handle('secret:has', ({ ref }) => ctx.secrets.has(rendererRef(ref, isRendererSecretRef)))
  handle('secret:reveal', ({ ref }) => ctx.secrets.reveal(rendererRef(ref, isRevealableSecretRef)))
  handle('secret:delete', ({ ref }) => ctx.secrets.delete(rendererRef(ref, isRendererSecretRef)))
}
