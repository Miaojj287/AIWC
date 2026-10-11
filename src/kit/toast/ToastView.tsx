import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { useT } from '@/i18n'
import { Button } from '../Button'
import { cn } from '../cn'
import { ICON_SIZE, ICON_STROKE } from '../icon'
import { IconButton } from '../IconButton'
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
  const t = useT()
  const meta = toast.kind === 'progress' ? null : ICON[toast.kind]
  return (
    <div
      role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}
      className={cn(
        'kit-toast pointer-events-auto flex min-w-[200px] max-w-[min(420px,calc(100vw-32px))] items-start gap-2 rounded-item border border-line-10 bg-overlay py-3 pl-3 pr-3 text-tab text-fg shadow-toast',
        className,
      )}
      {...rest}
    >
      {meta ? (
        <meta.icon
          size={ICON_SIZE.toast}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('shrink-0', meta.className)}
        />
      ) : (
        <Spinner size={13} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="break-words leading-4.5">{toast.text}</span>
        {toast.detail ? (
          <span className="mt-1 break-words text-caption leading-4.5 text-fg-2">{toast.detail}</span>
        ) : null}
      </div>
      {toast.action ? (
        <Button variant="link" size="sm" onClick={toast.action.onClick} className="-my-1 max-w-[140px] shrink-0 px-1.5">
          <span className="min-w-0 truncate" title={toast.action.label}>
            {toast.action.label}
          </span>
        </Button>
      ) : null}
      {onDismiss ? (
        <IconButton
          size="sm"
          icon={X}
          iconSize={11}
          label={t('kit.close')}
          onClick={onDismiss}
          className="-my-0.5 ml-0.5 text-fg-3"
        />
      ) : null}
    </div>
  )
}
