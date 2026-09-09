import type { AppContext } from '../contracts'

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
        if (!selected.wxid || !selected.dbRoot) throw new Error('请先选择微信账号和数据库目录')
        ctx.config.set({ account: { ...selected, verifiedAt: 0 } })
        const result = await ctx.substrate.reconnect()
        if (!result.ok) throw new Error(result.error ?? '数据库连接失败')
        const status = await ctx.substrate.refreshStatus()
        if (status.connection !== 'ready' || status.account?.wxid !== selected.wxid) {
          throw new Error('实际连接账号与所选账号不一致')
        }
        ctx.config.set({ account: { verifiedAt: Date.now() } })
        return { ok: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        ctx.config.replace({ ...ctx.config.get(), account: restore })
        if (active) {
          try {
            const result = await ctx.substrate.reconnect()
            if (!result.ok) return { ok: false, error: `${error}；原账号恢复失败：${result.error ?? '连接失败'}` }
          } catch (restoreError) {
            return { ok: false, error: `${error}；原账号恢复失败：${String(restoreError)}` }
          }
        }
        return { ok: false, error }
      }
    })
    pending = run.catch(() => {})
    return run
  }
}
