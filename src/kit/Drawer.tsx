import { X } from 'lucide-react'
import { Dialog as Radix } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE } from './icon'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Header right slot (filters, a button). */
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Panel width, default 360 (Figma). */
  width?: number
  className?: string
}

/**
 * Drawer — right-side panel, 360px, slides in over the same `--scrim` as Dialog (kit.css, via .kit-overlay). For long-list details
 * (all auto-reply records) — never for a new feature page, which is a workspace Tab (CLAUDE.md §1).
 */
export function Drawer({ open, onOpenChange, title, actions, children, footer, width = 360, className }: DrawerProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="kit-overlay fixed inset-0 z-50" />
        <Radix.Content
          style={{ width }}
          className={cn(
            'kit-drawer fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-line-10 bg-panel text-body text-fg outline-none',
            className,
          )}
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-6 pl-3 pr-2.5">
            <Radix.Title className="min-w-0 flex-1 truncate text-tab font-medium">{title}</Radix.Title>
            <Radix.Description className="sr-only">{title}</Radix.Description>
            {actions}
            <Radix.Close
              aria-label="关闭"
              className="inline-flex size-6 items-center justify-center rounded-control text-fg-3 outline-none hover:bg-line-8 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <X size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden />
            </Radix.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
          {footer ? <div className="shrink-0 border-t border-line-6 px-3 py-2.5">{footer}</div> : null}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  )
}
