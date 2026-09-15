/**
 * task:* — 定时任务. Definitions and run history come from the scheduler service; changes and run
 * progress are pushed on 'task:changed' / 'task:run' by the composition root.
 */
import { TASK_ID_RE } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

export function registerTaskIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { tasks } = ctx
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !TASK_ID_RE.test(value)) throw new Error(t('main.tasks.invalidId'))
    return value
  }
  const found = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error(t('main.tasks.notFound'))
    return value
  }

  handle('task:list', () => tasks.list())
  handle('task:get', (req) => tasks.get(id(req.id)))
  handle('task:save', (req) => tasks.save(req))
  handle('task:delete', (req) => tasks.remove(id(req.id)))
  handle('task:setEnabled', (req) => tasks.setEnabled(id(req.id), req.enabled === true))
  handle('task:runNow', (req) => found(tasks.runNow(id(req.id))))
  handle('task:cancel', (req) => tasks.cancel(id(req.id)))
  handle('task:runs', (req) => tasks.runs({ id: req?.id ? id(req.id) : undefined, limit: req?.limit }))
  handle('task:templates', () => tasks.templates())
}
