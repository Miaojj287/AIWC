/**
 * mcp:* / hooks:* — 设置 › 扩展. The service re-validates every request; this layer adds the one thing only main can
 * do: the native "run this command?" confirmation before a new or changed command / endpoint is saved. A renderer
 * that bypasses its own UI still cannot make the app run something the user did not see in a system dialog.
 */
import { dialog, type MessageBoxOptions } from 'electron'
import type { AppContext } from '../contracts'
import { fitsConfirmation } from '../extensions/confirmText'
import type { CommandConfirmation } from '../extensions/service'
import { t } from '../i18n'
import type { Handle, HostBridge } from './register'

export function registerExtensionsIpc(ctx: AppContext, host: HostBridge, handle: Handle): void {
  const confirm = async (request: CommandConfirmation): Promise<boolean> => {
    // The service normalises the detail and refuses one the dialog cannot show whole; never show a cut command.
    const detail = request.detail
    if (!fitsConfirmation(detail)) return false
    const opts: MessageBoxOptions = {
      type: 'warning',
      title: t('main.extensions.confirm.title'),
      message:
        request.kind === 'mcp'
          ? t('main.extensions.confirm.mcpMessage', { name: request.label })
          : t('main.extensions.confirm.hookMessage', { name: request.label }),
      detail: `${detail}\n\n${t(request.kind === 'mcp' ? 'main.extensions.confirm.mcpDetail' : 'main.extensions.confirm.hookDetail')}`,
      buttons: [t('main.extensions.confirm.cancel'), t('main.extensions.confirm.allow')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    const win = host.getMainWindow()
    const result = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return result.response === 1
  }

  handle('mcp:list', () => ctx.extensions.listMcp())
  handle('mcp:save', (draft) => ctx.extensions.saveMcp(draft, confirm))
  handle('mcp:remove', (req) => ctx.extensions.removeMcp(req?.id))
  handle('mcp:setEnabled', (req) => ctx.extensions.setMcpEnabled(req?.id, req?.enabled))
  handle('mcp:restart', (req) => ctx.extensions.restartMcp(req?.id))
  handle('mcp:setToolPolicy', (req) =>
    ctx.extensions.setToolPolicy({ id: req?.id, tool: req?.tool, risk: req?.risk, disabled: req?.disabled }),
  )
  handle('hooks:list', () => ctx.extensions.listHooks())
  handle('hooks:save', (draft) => ctx.extensions.saveHook(draft, confirm))
  handle('hooks:remove', (req) => ctx.extensions.removeHook(req?.id))
  handle('hooks:setEnabled', (req) => ctx.extensions.setHookEnabled(req?.id, req?.enabled))
  handle('hooks:test', (req) => ctx.extensions.testHook(req?.id))
}
