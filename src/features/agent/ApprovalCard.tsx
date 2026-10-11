/**
 * ApprovalCard — the 二次确认 for 高危 tool calls (CLAUDE.md §4.4, §5). It takes the composer's place at the bottom of
 * the conversation while the turn waits (the draft stays mounted underneath, hidden), and the tool row in the
 * transcript is marked 等待确认. The request is a short numbered list: 1 允许一次 · 2 总是允许 (hidden when the tool
 * cannot be allow-listed; shows what it allows and 本会话 / 所有会话, ←→ switches) · 3 拒绝 · 4 拒绝并说明 (a one-line
 * note handed back to the model). Digits answer at once (4 opens the note); ↑↓ move the selection; ⏎ confirms it;
 * Esc denies. A destructive request starts on 拒绝, so a stray ⏎ never deletes anything.
 *
 * Ask / Bypass both stop here for send + destructive; Ask also stops for write. Reads never reach it.
 *
 * The keys are scoped: they act only while focus is inside the card or nowhere at all, so Enter on a control
 * somewhere else in the window (a dialog's 取消, a menu item) can never approve a write or a send.
 */
import { AlertTriangle, Info, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ApprovalDecision, GrantScope, ToolRisk } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Button, cn, ICON_STROKE } from '@/kit'
import { grantLabel } from '@/platform/grants'
import { DenyReasonField, GrantScopeRow } from './ApprovalOptionExtras'
import type { ApprovalExtra, ApprovalRequest } from './model'
import { approvalBodyFor, approvalNoteFor } from './toolCards'
import { toolCallLabel } from './toolSummaries'

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

interface ApprovalOption {
  /** 'deny_reason' is a denial that carries the user's note. */
  id: ApprovalDecision | 'deny_reason'
  decision: ApprovalDecision
  label: MessageKey
  description: MessageKey
}

const ALLOW_ONCE: ApprovalOption = {
  id: 'allow_once',
  decision: 'allow_once',
  label: 'agent.approval.allowOnce',
  description: 'agent.approval.allowOnceHint',
}
const ALLOW_ALWAYS: ApprovalOption = {
  id: 'allow_always',
  decision: 'allow_always',
  label: 'agent.approval.allowAlways',
  description: 'agent.approval.allowAlwaysHint',
}
const DENY: ApprovalOption = {
  id: 'deny',
  decision: 'deny',
  label: 'agent.approval.deny',
  description: 'agent.approval.denyHint',
}
const DENY_WITH_REASON: ApprovalOption = {
  id: 'deny_reason',
  decision: 'deny',
  label: 'agent.approval.denyWithReason',
  description: 'agent.approval.denyWithReasonHint',
}

const TYPING_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CONTROL_SELECTOR = `button, a[href], summary, [role="button"], [role="link"], ${TYPING_SELECTOR}`
/** The slot the card shares with the composer: focus left there (the hidden draft) moves onto the card. */
export const APPROVAL_SCOPE_ATTR = 'data-approval-scope'

/** With nothing focused, `document.activeElement` and the target of a key event are both `<body>`. */
const isUnfocused = (node: EventTarget | null): boolean => node === null || node === document.body

export interface ApprovalCardProps {
  request: ApprovalRequest
  /** `extra` carries the 总是允许 scope or the 拒绝并说明 note. */
  onResolve: (approvalId: ApprovalRequest['approvalId'], decision: ApprovalDecision, extra?: ApprovalExtra) => void
  /** More requests of the thread waiting behind this one. */
  queued?: number
  /**
   * The card owns the keyboard (digits, ⏎, Esc) and takes focus on mount. Off for a card shown only for reference.
   */
  primary?: boolean
  className?: string
}

export function ApprovalCard({ request, onResolve, queued = 0, primary = true, className }: ApprovalCardProps) {
  const t = useT()
  const danger = request.risk === 'destructive'
  const options = [ALLOW_ONCE, ...(request.canAllowAlways ? [ALLOW_ALWAYS] : []), DENY, DENY_WITH_REASON]
  const denyIndex = options.indexOf(DENY)
  const [selected, setSelected] = useState(() => (danger ? denyIndex : 0))
  const [scope, setScope] = useState<GrantScope>('thread')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(false)
  const reasonRef = useRef<HTMLInputElement>(null)
  const grantKey = request.allowKey ?? request.toolName
  const RiskIcon = RISK_ICON[request.risk]
  // A feature may show its input in a reviewable form (a table preview, a command line) instead of raw JSON.
  const Body = approvalBodyFor(request.toolName)
  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const noteId = useId()
  const optionIdBase = useId()
  const optionId = (i: number) => `${optionIdBase}-${i}`
  const current = options[selected] ?? ALLOW_ONCE
  const resolve = (decision: ApprovalDecision): void => onResolve(request.approvalId, decision)
  const openReason = (): void => {
    setSelected(options.indexOf(DENY_WITH_REASON))
    // The field mounts with the selection; focus it once it is there.
    requestAnimationFrame(() => reasonRef.current?.focus())
  }
  const submitReason = (): void => {
    const note = reason.trim()
    if (!note) {
      setReasonError(true)
      reasonRef.current?.focus()
      return
    }
    onResolve(request.approvalId, 'deny', { reason: note })
  }
  /** Answer with an option, adding what it carries. */
  const choose = (option: ApprovalOption): void => {
    if (option.id === 'deny_reason') {
      if (reason.trim()) submitReason()
      else openReason()
      return
    }
    if (option.id === 'allow_always') onResolve(request.approvalId, 'allow_always', { scope })
    else resolve(option.decision)
  }

  // Take focus when it is nowhere or was left in the slot we now occupy (the hidden composer). A caret in any other
  // field stays put: the conversation's live region announces the request instead.
  useEffect(() => {
    if (!primary) return
    const active = document.activeElement
    const scope = cardRef.current?.closest(`[${APPROVAL_SCOPE_ATTR}]`)
    if (isUnfocused(active) || (active && scope?.contains(active))) listRef.current?.focus()
  }, [primary])

  const onKey = useEffectEvent((e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
    const card = cardRef.current
    const target = e.target instanceof Element ? e.target : null
    const inside = Boolean(card && target && card.contains(target))
    if (!inside && !isUnfocused(e.target)) return
    if (target?.matches(TYPING_SELECTOR)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      resolve('deny')
      return
    }
    if (/^[1-9]$/.test(e.key)) {
      const option = options[Number(e.key) - 1]
      if (!option) return
      e.preventDefault()
      choose(option)
      return
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && current.id === 'allow_always') {
      e.preventDefault()
      setScope((s) => (s === 'thread' ? 'global' : 'thread'))
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
      return
    }
    if (e.key !== 'Enter') return
    // Enter on another control inside the card (确认, a link in the preview) activates that control.
    const control = inside ? target?.closest(CONTROL_SELECTOR) : null
    if (control && card?.contains(control)) return
    e.preventDefault()
    choose(e.shiftKey && request.canAllowAlways ? ALLOW_ALWAYS : current)
  })
  useEffect(() => {
    if (!primary) return
    const listener = (e: KeyboardEvent): void => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [primary])

  return (
    <div
      ref={cardRef}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={noteId}
      data-testid="approval-card"
      data-risk={request.risk}
      className={cn(
        'flex w-full flex-col gap-3 rounded-card border bg-content p-3',
        danger ? 'border-danger/30' : 'border-line-10',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <RiskIcon
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('mt-[3px] shrink-0', danger ? 'text-danger' : 'text-accent')}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption font-medium text-fg-3">{t('agent.approval.heading')}</span>
          <span id={titleId} className="break-words text-body font-medium leading-5 text-fg">
            {t('agent.approval.request', { summary: toolCallLabel(request, t) })}
          </span>
          <span id={noteId} className="text-caption leading-4 text-fg-3">
            {approvalNoteFor(request, t) ?? t(RISK_COPY[request.risk])}
          </span>
        </div>
        {queued > 0 ? (
          <span className="shrink-0 text-caption text-fg-3">{t('agent.approval.queued', { n: queued })}</span>
        ) : null}
      </div>

      {Body ? (
        <Body request={request} />
      ) : request.detail ? (
        <div className="max-h-[132px] overflow-y-auto rounded-item border border-line-6 bg-panel px-2.5 py-2 text-caption leading-4.5 text-fg-2 whitespace-pre-wrap break-words select-text">
          {request.detail}
        </div>
      ) : (
        <pre className="m-0 max-h-[132px] overflow-auto rounded-item border border-line-6 bg-panel px-2.5 py-2 font-mono text-micro leading-4 text-fg-3 select-text">
          {safeJson(request.input)}
        </pre>
      )}

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label={t('agent.approval.options')}
        aria-activedescendant={optionId(selected)}
        className="flex flex-col gap-0.5 rounded-item outline-none"
      >
        {options.map((option, i) => {
          const isSelected = i === selected
          const description =
            option.id === 'allow_always'
              ? t('agent.approval.allowAlwaysFor', { target: grantLabel(grantKey) })
              : t(option.description)
          return (
            <div
              key={option.id}
              id={optionId(i)}
              role="option"
              aria-selected={isSelected}
              aria-keyshortcuts={primary ? String(i + 1) : undefined}
              data-decision={option.id}
              onClick={() =>
                isSelected ? choose(option) : option.id === 'deny_reason' ? openReason() : setSelected(i)
              }
              className={cn(
                'flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-item px-3 py-1.5 text-body',
                isSelected ? 'bg-selected ring-1 ring-inset ring-selected-ring' : 'hover:bg-hover-5',
              )}
            >
              <span
                className={cn('w-4 shrink-0 font-latin font-medium tabular-nums', isSelected ? 'text-fg' : 'text-fg-3')}
              >
                {i + 1}.
              </span>
              <span className="shrink-0 font-medium text-fg">{t(option.label)}</span>
              <span title={description} className="min-w-0 truncate text-caption text-fg-3">
                {description}
              </span>
            </div>
          )
        })}
      </div>
      {/* What the selected answer carries sits under the list (an option holds no controls of its own). */}
      {current.id === 'allow_always' ? <GrantScopeRow grantKey={grantKey} scope={scope} onScope={setScope} /> : null}
      {current.id === 'deny_reason' ? (
        <DenyReasonField
          ref={reasonRef}
          value={reason}
          error={reasonError}
          onChange={(value) => {
            setReason(value)
            if (value.trim()) setReasonError(false)
          }}
          onSubmit={submitReason}
          onLeave={() => listRef.current?.focus()}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <Info size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-caption text-fg-3">
          {current.id === 'allow_always'
            ? `${t('agent.approval.keyHint')} · ${t('agent.approval.scopeKeyHint')}`
            : t('agent.approval.keyHint')}
        </span>
        <Button
          size="sm"
          variant={danger && current.decision !== 'deny' ? 'danger' : 'primary'}
          aria-keyshortcuts={primary ? 'Enter' : undefined}
          onClick={() => choose(current)}
        >
          {t('agent.approval.confirm')}
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
