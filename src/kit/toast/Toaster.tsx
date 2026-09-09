import { useSyncExternalStore } from 'react'
import { cn } from '../cn'
import { ToastView } from './ToastView'
import { dismissToast, getToasts, pauseToast, resumeToast, subscribeToasts } from './toastStore'

export interface ToasterProps {
  className?: string
}

/**
 * Toaster — mount ONCE at the app root. Renders the store bottom-right, newest at the bottom.
 * Hovering a toast pauses its timer.
 */
export function Toaster({ className }: ToasterProps) {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className={cn('pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2', className)}
    >
      {toasts.map((t) => (
        <ToastView
          key={t.id}
          toast={t}
          onDismiss={() => dismissToast(t.id)}
          onMouseEnter={() => pauseToast(t.id)}
          onMouseLeave={() => resumeToast(t.id)}
        />
      ))}
    </div>
  )
}
