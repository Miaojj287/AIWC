import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { cn } from '../cn'
import { ICON_SIZE, ICON_STROKE } from '../icon'
import { Spinner } from '../Spinner'
import type { ToastItem, ToastKind } from './toastStore'

const ICON: Record<Exclude<ToastKind, 'progress'>, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: 'text-ok' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warn' },
  error: { icon: CircleAlert, className: 'text-danger' },
}

export interface ToastViewProps extends HTMLAttributes<HTMLDivElement> {
  toast: Pick<ToastItem, 'kind' | 'text' | 'detail' | 'action'>
  onDismiss?: () => void
}

/**
 * ToastView — one toast: raised ground, line-10 border, r8, icon 14 + text 12.5 + link action + × 11.
 * Figma 154:887. Pure presentational; <Toaster/> wires it to the store.
 */
export function ToastView({ toast, onDismiss, className, ...rest }: ToastViewProps) {
  const meta = toast.kind === 'progress' ? null : ICON[toast.kind]
  return (
    <div
      role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}
      className={cn(
        'kit-toast pointer-events-auto flex min-w-[200px] max-w-[420px] items-center gap-2 rounded-item border border-line-10 bg-raised py-2 pl-2.5 pr-3 text-tab text-fg shadow-toast',
        className,
      )}
      {...rest}
    >
      {meta ? (
        <meta.icon size={ICON_SIZE.toast} strokeWidth={ICON_STROKE} aria-hidden className={cn('shrink-0', meta.className)} />
      ) : (
        <Spinner size={13} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-4">{toast.text}</span>
        {toast.detail ? <span className="truncate text-micro leading-4 text-fg-3">{toast.detail}</span> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={toast.action.onClick}
          className="shrink-0 rounded-sm px-0.5 text-tab text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {toast.action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="关闭"
          onClick={onDismiss}
          className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-3 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <X size={11} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
