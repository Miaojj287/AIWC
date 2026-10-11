/**
 * The two answers of the ApprovalCard that carry more than a decision:
 *  - 总是允许 shows what it would allow (the tool, or a command prefix) and where: 本会话 / 所有会话 (←→ switches);
 *  - 拒绝并说明 opens a one-line note that goes back to the model with the denial (⏎ sends, Esc returns to the list).
 */
import { forwardRef, type KeyboardEvent } from 'react'
import type { GrantScope } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Input, SegmentedControl } from '@/kit'
import { grantLabel } from '@/platform/grants'

export function GrantScopeRow({
  grantKey,
  scope,
  onScope,
}: {
  grantKey: string
  scope: GrantScope
  onScope: (scope: GrantScope) => void
}) {
  const t = useT()
  const target = grantLabel(grantKey)
  return (
    <div className="-mt-1 flex min-w-0 flex-wrap items-center gap-2 px-3" data-testid="grant-scope">
      <span className="text-caption text-fg-3">{t('agent.approval.scopeLabel')}</span>
      <SegmentedControl<GrantScope>
        size="sm"
        aria-label={t('agent.approval.scopeLabel')}
        value={scope}
        onValueChange={onScope}
        options={[
          { value: 'thread', label: t('agent.approval.scope.thread') },
          { value: 'global', label: t('agent.approval.scope.global') },
        ]}
      />
      <span title={target} className="min-w-0 truncate font-mono text-caption text-fg-3">
        {grantKey}
      </span>
    </div>
  )
}

export interface DenyReasonFieldProps {
  value: string
  onChange: (value: string) => void
  /** ⏎ with a note. */
  onSubmit: () => void
  /** Esc / ↑: back to the option list (the denial is not sent). */
  onLeave: () => void
  error?: boolean
}

export const DenyReasonField = forwardRef<HTMLInputElement, DenyReasonFieldProps>(function DenyReasonField(
  { value, onChange, onSubmit, onLeave, error },
  ref,
) {
  const t = useT()
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    } else if (e.key === 'Escape' || e.key === 'ArrowUp') {
      e.preventDefault()
      onLeave()
    }
  }
  return (
    <div className="-mt-1 px-3">
      <Input
        ref={ref}
        size="sm"
        value={value}
        maxLength={1000}
        aria-label={t('agent.approval.reasonLabel')}
        placeholder={t('agent.approval.reasonPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        error={error ? t('agent.approval.reasonRequired') : undefined}
        hint={error ? undefined : t('agent.approval.reasonKeyHint')}
      />
    </div>
  )
})
