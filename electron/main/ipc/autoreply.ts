import type { AppContext } from '../contracts'
import { normaliseRule, validateRule } from '../services/autoReplyRules'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

export function registerAutoReplyIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { records, autoReply, uiSender } = ctx

  handle('autoreply:listRules', () => records.listRules())
  handle('autoreply:getRule', ({ sessionId }) => records.getRule(sessionId))
  handle('autoreply:saveRule', (rule) => {
    const error = validateRule(rule)
    if (error) throw new Error(error)
    const existing = records.getRule(rule.sessionId)
    autoReply.invalidate(rule.sessionId, t('main.autoReply.ruleUpdated'))
    const saved = records.saveRule(
      normaliseRule({
        ...rule,
        accountId: ctx.substrate.status().account?.wxid ?? existing?.accountId,
        id: rule.id || existing?.id || '',
      }),
    )
    void ctx.autoReplyMonitor.refresh()
    ctx.broadcast('autoreply:rulesChanged', { sessionId: saved.sessionId })
    ctx.toast({ kind: 'success', text: t('main.autoReply.ruleSaved') })
    return saved
  })
  handle('autoreply:setEnabled', ({ sessionId, enabled }) => {
    const rule = records.getRule(sessionId)
    const accountId = ctx.substrate.status().account?.wxid
    if (enabled && rule?.accountId && accountId && rule.accountId !== accountId)
      throw new Error(t('main.autoReply.ruleOtherAccountEnable'))
    autoReply.invalidate(sessionId, enabled ? t('main.autoReply.ruleReenabled') : t('main.autoReply.rulePaused'))
    records.setEnabled(sessionId, enabled)
    ctx.broadcast('autoreply:rulesChanged', { sessionId })
    void ctx.autoReplyMonitor.refresh()
  })
  handle('autoreply:deleteRule', ({ sessionId }) => {
    autoReply.invalidate(sessionId, t('main.autoReply.ruleDeleted'))
    records.deleteRule(sessionId)
    ctx.broadcast('autoreply:rulesChanged', { sessionId })
    void ctx.autoReplyMonitor.refresh()
  })

  handle('autoreply:listRecords', (q) =>
    records.listRecords({ sessionId: q.sessionId, status: q.status, limit: q.limit ?? 100 }),
  )
  handle('autoreply:recall', ({ recordId }) => autoReply.recall(recordId))

  handle('autoreply:listDrafts', () => autoReply.listDrafts())
  handle('autoreply:resolveDraft', ({ draftId, decision, text }) => autoReply.resolveDraft(draftId, decision, text))
  handle('autoreply:holdDraft', ({ draftId }) => autoReply.hold(draftId))
  handle('autoreply:retryDraft', ({ draftId }) => autoReply.retry(draftId))
  handle('autoreply:status', () => ({
    halted: autoReply.haltReason,
    connection: ctx.substrate.status().connection,
    accountId: ctx.substrate.status().account?.wxid,
    demo: ctx.substrate.mode() === 'demo',
    queued: uiSender.queued,
    generating: autoReply.listGenerating(),
  }))
  handle('autoreply:triggerNow', async ({ sessionId }) => {
    const result = await ctx.autoReplyMonitor.triggerNow(sessionId)
    if (!result.triggered) ctx.toast({ kind: 'warning', text: result.reason ?? t('main.autoReply.nothingToReply') })
    else ctx.toast({ kind: 'info', text: t('main.autoReply.triggered') })
    return result
  })
  handle('autoreply:resume', () => {
    uiSender.resume()
    autoReply.resume()
    ctx.toast({ kind: 'success', text: t('main.autoReply.resumed') })
  })
}
