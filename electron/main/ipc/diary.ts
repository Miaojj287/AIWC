import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function registerDiaryIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { diaries, diary } = ctx
  handle('diary:list', () => diaries.list())
  handle('diary:get', ({ date }) => diaries.get(date))
  handle('diary:generate', async ({ date, force }) => {
    if (!DATE_RE.test(date)) throw new Error(t('main.files.diaryDateFormat'))
    const entry = await diary.run(date, {
      force,
      onProgress: (step, fraction) => ctx.broadcast('diary:progress', { date, step, fraction }),
    })
    ctx.broadcast('diary:progress', { date, step: 'done', fraction: 1 })
    return entry
  })
}
