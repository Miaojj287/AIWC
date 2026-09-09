import type { AppContext } from '../contracts'
import { normaliseRule, validateRule } from '../services/autoReplyRules'
import type { Handle, HostBridge } from './register'

export function registerAutoReplyIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { records, autoReply, uiSender } = ctx

  handle('autoreply:listRules', () => records.listRules())
  handle('autoreply:getRule', ({ sessionId }) => records.getRule(sessionId))
  handle('autoreply:saveRule', (rule) => {
    const error = validateRule(rule)
    if (error) throw new Error(error)
    const existing = records.getRule(rule.sessionId)
    autoReply.invalidate(rule.sessionId, '规则已更新')
    const saved = records.saveRule(normaliseRule({ ...rule, accountId: ctx.substrate.status().account?.wxid ?? existing?.accountId, id: rule.id || existing?.id || '' }))
    void ctx.autoReplyMonitor.refresh()
    ctx.broadcast('autoreply:rulesChanged', { sessionId: saved.sessionId })
    ctx.toast({ kind: 'success', text: '自动回复规则已保存' })
    return saved
  })
  handle('autoreply:setEnabled', ({ sessionId, enabled }) => {
    const rule = records.getRule(sessionId)
    const accountId = ctx.substrate.status().account?.wxid
    if (enabled && rule?.accountId && accountId && rule.accountId !== accountId) throw new Error('规则属于另一个微信账户，请在当前账户重新保存规则后启用')
    autoReply.invalidate(sessionId, enabled ? '规则已重新启用' : '规则已暂停')
    records.setEnabled(sessionId, enabled)
    ctx.broadcast('autoreply:rulesChanged', { sessionId })
    void ctx.autoReplyMonitor.refresh()
  })
  handle('autoreply:deleteRule', ({ sessionId }) => { autoReply.invalidate(sessionId, '规则已删除'); records.deleteRule(sessionId); ctx.broadcast('autoreply:rulesChanged', { sessionId }); void ctx.autoReplyMonitor.refresh() })

  handle('autoreply:listRecords', (q) => records.listRecords({ sessionId: q.sessionId, status: q.status, limit: q.limit ?? 100 }))
  handle('autoreply:recall', ({ recordId }) => autoReply.recall(recordId))

  handle('autoreply:listDrafts', () => autoReply.listDrafts())
  handle('autoreply:resolveDraft', ({ draftId, decision, text }) => autoReply.resolveDraft(draftId, decision, text))
  handle('autoreply:holdDraft', ({ draftId }) => autoReply.hold(draftId))
  handle('autoreply:retryDraft', ({ draftId }) => autoReply.retry(draftId))
  handle('autoreply:status', () => ({ halted: autoReply.haltReason, connection: ctx.substrate.status().connection, accountId: ctx.substrate.status().account?.wxid, demo: ctx.substrate.mode() === 'demo', queued: uiSender.queued, generating: autoReply.listGenerating() }))
  handle('autoreply:triggerNow', async ({ sessionId }) => {
    const result = await ctx.autoReplyMonitor.triggerNow(sessionId)
    if (!result.triggered) ctx.toast({ kind: 'warning', text: result.reason ?? '没有可以回复的消息' })
    else ctx.toast({ kind: 'info', text: '已触发一次自动回复，正在生成…' })
    return result
  })
  handle('autoreply:resume', () => {
    uiSender.resume()
    autoReply.resume()
    ctx.toast({ kind: 'success', text: '自动回复已恢复' })
  })
}
