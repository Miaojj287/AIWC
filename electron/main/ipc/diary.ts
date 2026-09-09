import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function registerDiaryIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { diaries, diary } = ctx
  handle('diary:list', () => diaries.list())
  handle('diary:get', ({ date }) => diaries.get(date))
  handle('diary:generate', async ({ date, force }) => {
    if (!DATE_RE.test(date)) throw new Error('日期格式应为 YYYY-MM-DD')
    const entry = await diary.run(date, {
      force,
      onProgress: (step, fraction) => ctx.broadcast('diary:progress', { date, step, fraction }),
    })
    ctx.broadcast('diary:progress', { date, step: 'done', fraction: 1 })
    return entry
  })
}
