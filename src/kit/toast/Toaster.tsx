import { useSyncExternalStore } from 'react'
import { cn } from '../cn'
import { ToastView } from './ToastView'
import { dismissToast, getToasts, pauseToast, resumeToast, subscribeToasts } from './toastStore'

export interface ToasterProps {
  className?: string
}

/**
 * Toaster — mount ONCE at the app root. Renders the store top-centre, below the 40px tab strips, newest at the
 * bottom of the stack. Top-centre keeps it clear of the composers and footers that sit at the bottom of every column.
 * Hovering a toast pauses its timer.
 */
export function Toaster({ className }: ToasterProps) {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (toasts.length === 0) return null
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-12 z-[60] flex flex-col items-center gap-2 px-4',
        className,
      )}
    >
      {toasts.map((t) => (
        <ToastView
          key={t.id}
          toast={t}
          onDismiss={() => dismissToast(t.id)}
          onMouseEnter={() => pauseToast(t.id)}
          onMouseLeave={(event) => {
            if (!event.currentTarget.contains(document.activeElement)) resumeToast(t.id)
          }}
          onFocus={() => pauseToast(t.id)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) {
              resumeToast(t.id)
            }
          }}
        />
      ))}
    </div>
  )
}
