import { Check, Circle, CircleAlert, Info, Pencil, RefreshCw, Trash } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './Button'
import { cn } from './cn'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, type DialogTone } from './Dialog'
import { ICON_STROKE, type IconComponent } from './icon'
import { Input } from './Input'
import { ProgressBar } from './ProgressBar'
import { Spinner } from './Spinner'

interface BaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  icon?: IconComponent
  className?: string
}

/**
 * Guards the confirm / submit handler of every dialog variant: while the returned promise is pending
 * the button shows a spinner and a second click is dropped, so 删除 / 保存 / 发送 can never run twice
 * on a double click (CLAUDE.md §4.4, 交互准则 3). Callers that own the pending state pass `loading`
 * themselves; both sources are OR-ed.
 */
function useConfirmGuard(handler: () => void | Promise<void>, external: boolean): { busy: boolean; run: () => void } {
  const [pending, setPending] = useState(false)
  const inflight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = () => {
    if (inflight.current || external) return
    const result = handler()
    if (!(result instanceof Promise)) return
    inflight.current = true
    setPending(true)
    void result.finally(() => {
      inflight.current = false
      if (alive.current) setPending(false)
    })
  }
  return { busy: pending || external, run }
}

/* ------------------------------------------------------------------ confirm */

export interface ConfirmDialogProps extends BaseDialogProps {
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  /** Shows a spinner in the primary button and disables both. */
  loading?: boolean
  tone?: DialogTone
  children?: ReactNode
}

/** 普通确认 — info icon, 取消 (default focus) + primary 确定. Scrim click closes. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  icon = Info,
  tone = 'info',
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  loading = false,
  children,
  className,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { busy, run } = useConfirmGuard(onConfirm, loading)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm" className={className} lockOutside={busy} lockEscape={busy} onOpenAutoFocus={(e) => {
        e.preventDefault()
        cancelRef.current?.focus()
      }}>
        <DialogHeader icon={icon} tone={tone} title={title} description={description} />
        {children ? <DialogBody>{children}</DialogBody> : null}
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------- danger */

export interface DangerDialogProps extends BaseDialogProps {
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  /** Require typing this word before the danger button enables (清空记忆 etc.). */
  confirmWord?: string
  children?: ReactNode
}

/**
 * 危险确认 — trash icon on danger ground, danger primary, default focus on 取消,
 * clicking the scrim does NOT close (CLAUDE.md §4.4).
 */
export function DangerDialog({
  open,
  onOpenChange,
  title,
  description,
  icon = Trash,
  confirmLabel = '删除',
  cancelLabel = '取消',
  onConfirm,
  loading = false,
  confirmWord,
  children,
  className,
}: DangerDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  const gated = Boolean(confirmWord) && typed.trim() !== confirmWord
  const { busy, run } = useConfirmGuard(onConfirm, loading)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="sm"
        lockOutside
        lockEscape={busy}
        className={className}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader icon={icon} tone="danger" title={title} description={description} />
        {children || confirmWord ? (
          <DialogBody>
            {children}
            {confirmWord ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-note text-fg-3">
                  输入「{confirmWord}」以确认
                </span>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord} aria-label="确认词" />
              </div>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={run} loading={busy} disabled={gated} title={gated ? `请先输入确认词「${confirmWord}」` : undefined}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------------------- form */

export interface FormDialogProps extends BaseDialogProps {
  submitLabel?: string
  cancelLabel?: string
  onSubmit: () => void | Promise<void>
  submitDisabled?: boolean
  /** Tooltip-style reason shown on the disabled submit button (CLAUDE.md §4.6). */
  submitDisabledReason?: string
  loading?: boolean
  /** 440 by default; `xl` = 520. */
  size?: 'lg' | 'xl'
  children: ReactNode
}

/** 表单对话框 — pencil icon, fields in the body (use FormDialogField for the 64px label column), 取消 + primary 保存. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  icon = Pencil,
  submitLabel = '保存',
  cancelLabel = '取消',
  onSubmit,
  submitDisabled = false,
  submitDisabledReason,
  loading = false,
  size = 'lg',
  children,
  className,
}: FormDialogProps) {
  const { busy, run } = useConfirmGuard(onSubmit, loading)
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (submitDisabled || busy) return
    run()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size={size} lockEscape={busy} className={className}>
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader icon={icon} tone="accent" title={title} description={description} />
          <DialogBody>{children}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={submitDisabled} title={submitDisabled ? submitDisabledReason : undefined}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface FormDialogFieldProps {
  label: ReactNode
  htmlFor?: string
  /** Align the label to the top for tall controls. */
  alignTop?: boolean
  children: ReactNode
  className?: string
}

/** Row: label 64px (12.5 fg-2) | control fills. */
export function FormDialogField({ label, htmlFor, alignTop = false, children, className }: FormDialogFieldProps) {
  return (
    <div className={cn('flex gap-3', alignTop ? 'items-start' : 'items-center', className)}>
      <label htmlFor={htmlFor} className={cn('w-16 shrink-0 text-tab text-fg-2', alignTop && 'pt-2')}>
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- progress */

export type ProgressStepStatus = 'todo' | 'doing' | 'done' | 'failed'

export interface ProgressStep {
  id: string
  label: ReactNode
  status: ProgressStepStatus
  /** Right-aligned detail: elapsed time, "进行中", an error. */
  detail?: ReactNode
}

export interface ProgressDialogProps extends Omit<BaseDialogProps, 'onOpenChange'> {
  /** 0–100; omit for indeterminate. */
  value?: number
  /** Status line under the bar, e.g. 第 2 / 4 步 · 预计还需 20 秒. */
  status?: ReactNode
  steps?: ProgressStep[]
  cancelLabel?: string
  /** The only button. Omit to hide it (task cannot be cancelled). */
  onCancel?: () => void
  /** Small note above the button, e.g. 请勿关闭微信. */
  note?: ReactNode
}

const STEP_ICON: Record<ProgressStepStatus, ReactNode> = {
  done: <Check size={13} strokeWidth={2} aria-hidden className="text-ok" />,
  doing: <Spinner size={13} />,
  todo: <Circle size={11} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-3" />,
  failed: <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="text-danger" />,
}

/**
 * 进度对话框 — long tasks (key acquisition, cloning, downloads; CLAUDE.md §4.5):
 * progress bar + status line + step list ✓/⟳/○/!, only a 取消 button, scrim and Escape do not close.
 */
export function ProgressDialog({ open, title, description, icon = RefreshCw, value, status, steps, cancelLabel = '取消', onCancel, note, className }: ProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel?.()}>
      <DialogContent size="md" lockOutside lockEscape={!onCancel} hideClose={!onCancel} className={className}>
        <DialogHeader icon={icon} tone="accent" title={title} description={description} />
        <DialogBody>
          <ProgressBar value={value} label={typeof title === 'string' ? title : undefined} />
          {status ? (
            <div className="flex items-center gap-2 text-tab text-fg-2">
              <Spinner size={13} />
              <span className="min-w-0 truncate">{status}</span>
            </div>
          ) : null}
          {steps && steps.length > 0 ? (
            <ol className="flex flex-col gap-1.5 pt-0.5">
              {steps.map((s) => (
                <li key={s.id} data-status={s.status} className="flex items-center gap-2 text-tab">
                  <span className="flex size-4 shrink-0 items-center justify-center">{STEP_ICON[s.status]}</span>
                  <span className={cn('min-w-0 flex-1 truncate', s.status === 'todo' ? 'text-fg-3' : s.status === 'failed' ? 'text-danger' : 'text-fg')}>{s.label}</span>
                  {s.detail ? <span className={cn('shrink-0 text-micro', s.status === 'failed' ? 'text-danger' : 'text-fg-3')}>{s.detail}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </DialogBody>
        {note || onCancel ? (
          <DialogFooter className={note ? 'justify-between' : undefined}>
            {note ? <span className="text-note text-fg-3">{note}</span> : null}
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} autoFocus>
                {cancelLabel}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
