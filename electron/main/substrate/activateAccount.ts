import type { AppContext } from '../contracts'
import { t } from '../i18n'

/** Serialize selection + reconnect so config, source and status commit as one operation. */
export function createAccountActivator(ctx: Pick<AppContext, 'config' | 'substrate'>) {
  let pending: Promise<unknown> = Promise.resolve()
  return (target: { wxid: string; dbRoot: string } | void) => {
    const run = pending.then(async () => {
      const previous = ctx.config.get().account
      const active = ctx.substrate.status().account
      // The old renderer could save B while the source remained A. Restore A on failure.
      const restore = active ? { ...previous, wxid: active.wxid, dbRoot: active.dbRoot } : previous
      const selected = target ?? previous
      try {
        if (!selected.wxid || !selected.dbRoot) throw new Error(t('main.substrate.selectAccountAndDbRoot'))
        ctx.config.set({ account: { ...selected, verifiedAt: 0 } })
        const result = await ctx.substrate.reconnect()
        if (!result.ok) throw new Error(result.error ?? t('main.substrate.connectFailed'))
        const status = await ctx.substrate.refreshStatus()
        if (status.connection !== 'ready' || status.account?.wxid !== selected.wxid) {
          throw new Error(t('main.substrate.accountMismatch'))
        }
        ctx.config.set({ account: { verifiedAt: Date.now() } })
        return { ok: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        ctx.config.replace({ ...ctx.config.get(), account: restore })
        if (active) {
          try {
            const result = await ctx.substrate.reconnect()
            if (!result.ok)
              return {
                ok: false,
                error: t('main.substrate.restoreFailed', {
                  error,
                  detail: result.error ?? t('main.substrate.connectionFailed'),
                }),
              }
          } catch (restoreError) {
            return { ok: false, error: t('main.substrate.restoreFailed', { error, detail: String(restoreError) }) }
          }
        }
        return { ok: false, error }
      }
    })
    pending = run.catch(() => {})
    return run
  }
}
