/**
 * Answering an approval from either Agent surface: forwards the decision (with its 拒绝并说明 note or 总是允许
 * scope) and, for a grant, says what was allowed and where it can be revoked (设置 › AI 接入 › 权限规则).
 */
import type { ApprovalDecision, ThreadId } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { grantLabel } from '@/platform/grants'
import { useAgentStore } from './agentStore'
import type { ApprovalExtra, ApprovalRequest } from './model'

/** Settings row the grant toast and the permission menu jump to. */
const PERMISSION_RULES_HIGHLIGHT = 'ai.permissions'

function openPermissionRules(): void {
  runCommand('tab.openSettings', { page: 'ai', highlight: PERMISSION_RULES_HIGHLIGHT })
}

export function answerApproval(
  threadId: ThreadId,
  request: ApprovalRequest,
  decision: ApprovalDecision,
  extra?: ApprovalExtra,
): void {
  void useAgentStore.getState().resolveApproval(threadId, request.approvalId, decision, extra)
  if (decision !== 'allow_always') return
  const scope = extra?.scope ?? 'thread'
  toast.success(
    t('agent.approval.grantedToast', {
      target: grantLabel(request.allowKey ?? request.toolName),
      scope: scope === 'global' ? t('agent.approval.scope.global') : t('agent.approval.scope.thread'),
    }),
    { action: { label: t('agent.approval.manageGrants'), onClick: openPermissionRules } },
  )
}
