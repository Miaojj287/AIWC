/**
 * ApprovalCard — the 二次确认 for 高危 tool calls (CLAUDE.md §4.4, §5). Rendered **inline** right under
 * the awaiting tool row, the way Cursor / Codex / Claude Code do it: the request never floats away from
 * the transcript, never needs a portal to be reachable, and survives scrolling.
 *
 * Ask / Bypass both stop here for send + destructive; Ask also stops for write. Reads never reach it.
 * Buttons: 拒绝 (Esc) · 总是允许 (⇧⏎, hidden when the tool cannot be allow-listed) · 允许一次 (⏎, primary).
 */
import { AlertTriangle, Check, CheckCheck, Send, ShieldAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ApprovalDecision, ToolRisk } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Button, cn, ICON_STROKE, Kbd } from '@/kit'
import type { ApprovalRequest } from './model'
import { approvalBodyFor, approvalNoteFor } from './toolCards'

const RISK_COPY: Record<ToolRisk, MessageKey> = {
  read: 'agent.approval.risk.read',
  write: 'agent.approval.risk.write',
  send: 'agent.approval.risk.send',
  destructive: 'agent.approval.risk.destructive',
}

const RISK_ICON: Record<ToolRisk, typeof Send> = {
  read: ShieldAlert,
  write: ShieldAlert,
  send: Send,
  destructive: AlertTriangle,
}

export interface ApprovalCardProps {
  request: ApprovalRequest
  onResolve: (approvalId: ApprovalRequest['approvalId'], decision: ApprovalDecision) => void
  /**
   * The card is the oldest pending request in the thread: it takes the ⏎ / ⇧⏎ / Esc keys and
   * focuses 允许一次 on mount. Later requests queue behind it and only respond to clicks.
   */
  primary?: boolean
  className?: string
}

export function ApprovalCard({ request, onResolve, primary = true, className }: ApprovalCardProps) {
  const t = useT()
  const danger = request.risk === 'destructive'
  const { canAllowAlways } = request
  const RiskIcon = RISK_ICON[request.risk]
  // A feature may show its input in a reviewable form (a table preview) instead of raw JSON.
  const Body = approvalBodyFor(request.toolName)
  const allowRef = useRef<HTMLButtonElement>(null)
  const resolve = (decision: ApprovalDecision): void => onResolve(request.approvalId, decision)
  // The listener is registered once per request; it reads the latest resolve through this ref.
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  // Keyboard: the composer keeps the caret, so the keys live on the window and stand down while the
  // user is typing anywhere else.
  useEffect(() => {
    if (!primary) return
    allowRef.current?.focus({ preventScroll: false })
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        e.preventDefault()
        resolveRef.current('deny')
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        resolveRef.current(e.shiftKey && canAllowAlways ? 'allow_always' : 'allow_once')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [primary, canAllowAlways])

  return (
    <div
      role="alertdialog"
      aria-label={t('agent.approval.request', { summary: request.summary })}
      data-testid="approval-card"
      data-risk={request.risk}
      className={cn(
        'flex w-full flex-col gap-2.5 rounded-item border bg-panel px-3 py-2.5',
        danger ? 'border-danger/30 bg-danger/[0.06]' : 'border-accent/30 bg-accent/[0.06]',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <RiskIcon
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('mt-px shrink-0', danger ? 'text-danger' : 'text-accent')}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body font-medium leading-[18px] text-fg">
            {t('agent.approval.request', { summary: request.summary })}
          </span>
          <span className="text-note leading-4 text-fg-3">
            {approvalNoteFor(request, t) ?? t(RISK_COPY[request.risk])}
          </span>
        </div>
      </div>

      {Body ? (
        <Body request={request} />
      ) : request.detail ? (
        <div className="max-h-[132px] overflow-y-auto rounded-control border border-line-6 bg-content px-2.5 py-2 text-caption leading-[18px] text-fg-2 whitespace-pre-wrap break-words select-text">
          {request.detail}
        </div>
      ) : (
        <pre className="m-0 max-h-[132px] overflow-auto rounded-control border border-line-6 bg-content px-2.5 py-2 font-mono text-micro leading-4 text-fg-3 select-text">
          {safeJson(request.input)}
        </pre>
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={X}
          aria-label={t('agent.approval.deny')}
          onClick={() => resolve('deny')}
        >
          {t('agent.approval.deny')}
          {primary ? <Kbd keys="Esc" className="ml-0.5 bg-transparent px-0 text-current opacity-60" /> : null}
        </Button>
        {canAllowAlways ? (
          <Button
            size="sm"
            variant="ghost"
            icon={CheckCheck}
            aria-label={t('agent.approval.allowAlways')}
            onClick={() => resolve('allow_always')}
            title={t('agent.approval.allowAlwaysHint')}
          >
            {t('agent.approval.allowAlways')}
            {primary ? <Kbd keys="⇧⏎" className="ml-0.5 bg-transparent px-0 text-current opacity-60" /> : null}
          </Button>
        ) : null}
        <Button
          ref={allowRef}
          size="sm"
          variant={danger ? 'danger' : 'primary'}
          icon={Check}
          aria-label={t('agent.approval.allowOnce')}
          onClick={() => resolve('allow_once')}
        >
          {t('agent.approval.allowOnce')}
          {primary ? <Kbd keys="⏎" className="ml-0.5 bg-transparent px-0 text-current opacity-70" /> : null}
        </Button>
      </div>
    </div>
  )
}

export function safeJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')
  } catch {
    return String(value)
  }
}
