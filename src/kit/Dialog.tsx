import { X } from 'lucide-react'
import { Dialog as Radix } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'

/**
 * Dialog primitives — panel ground, line-10 border, r12, p20, overlay shadow; scrim = the shared `--scrim` (kit.css, via .kit-overlay).
 * Figma 154:1084 / 1105 / 1143 / 1170. Compose them, or use the four ready-made variants in
 * DialogVariants.tsx (ConfirmDialog / DangerDialog / FormDialog / ProgressDialog).
 */
export const Dialog = Radix.Root
export const DialogTrigger = Radix.Trigger
export const DialogClose = Radix.Close
export const DialogTitle = Radix.Title
export const DialogDescription = Radix.Description

export type DialogTone = 'info' | 'accent' | 'danger' | 'ok' | 'warn'

const TONE_BOX: Record<DialogTone, string> = {
  info: 'bg-info/15 text-info',
  accent: 'bg-accent-15 text-accent',
  danger: 'bg-danger/15 text-danger',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
}

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof Radix.Content> {
  /** 380 (confirm) / 400 (progress) / 440 (form) / 520 (wide) px. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Clicking the scrim does not close (danger confirmations, running tasks). */
  lockOutside?: boolean
  /** Escape does not close (running tasks). */
  lockEscape?: boolean
  /** Hide the top-right ×. */
  hideClose?: boolean
}

const SIZE: Record<NonNullable<DialogContentProps['size']>, string> = {
  sm: 'w-[380px]',
  md: 'w-[400px]',
  lg: 'w-[440px]',
  xl: 'w-[520px]',
}

export const DialogContent = forwardRef<ElementRef<typeof Radix.Content>, DialogContentProps>(function DialogContent(
  { size = 'sm', lockOutside = false, lockEscape = false, hideClose = false, className, children, onPointerDownOutside, onInteractOutside, onEscapeKeyDown, ...rest },
  ref,
) {
  return (
    <Radix.Portal>
      <Radix.Overlay className="kit-overlay fixed inset-0 z-50" />
      <Radix.Content
        ref={ref}
        onPointerDownOutside={(e) => {
          onPointerDownOutside?.(e)
          if (lockOutside) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e)
          if (lockOutside) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          onEscapeKeyDown?.(e)
          if (lockEscape) e.preventDefault()
        }}
        className={cn(
          'kit-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3.5',
          'rounded-card border border-line-10 bg-panel p-5 text-body text-fg shadow-overlay outline-none',
          SIZE[size],
          className,
        )}
        {...rest}
      >
        {children}
        {hideClose ? null : (
          <Radix.Close
            aria-label="关闭"
            className="absolute right-4 top-4 inline-flex size-6 items-center justify-center rounded-control text-fg-3 outline-none hover:bg-line-8 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <X size={ICON_SIZE.menuAux} strokeWidth={ICON_STROKE} aria-hidden />
          </Radix.Close>
        )}
      </Radix.Content>
    </Radix.Portal>
  )
})

export interface DialogHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: IconComponent
  tone?: DialogTone
  title: ReactNode
  description?: ReactNode
}

/** Icon box 36 r10 (tone 15% ground) | title 14 Medium + description 12.5 fg-2. */
export function DialogHeader({ icon: Icon, tone = 'accent', title, description, className, ...rest }: DialogHeaderProps) {
  return (
    <div className={cn('flex items-start gap-3 pr-6', className)} {...rest}>
      {Icon ? (
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-window', TONE_BOX[tone])}>
          <Icon size={ICON_SIZE.dialog} strokeWidth={ICON_STROKE} aria-hidden />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Radix.Title className="text-bubble font-medium leading-5 text-fg">{title}</Radix.Title>
        {description ? (
          <Radix.Description className="text-tab leading-4.5 text-fg-2">{description}</Radix.Description>
        ) : (
          <Radix.Description className="sr-only">{title}</Radix.Description>
        )}
      </div>
    </div>
  )
}

export type DialogBodyProps = HTMLAttributes<HTMLDivElement>

export function DialogBody({ className, ...rest }: DialogBodyProps) {
  return <div className={cn('flex min-h-0 flex-col gap-2.5 overflow-y-auto', className)} {...rest} />
}

export type DialogFooterProps = HTMLAttributes<HTMLDivElement>

/** Buttons right-aligned, gap 8. Put 取消 first; at most one primary. */
export function DialogFooter({ className, ...rest }: DialogFooterProps) {
  return <div className={cn('flex items-center justify-end gap-2', className)} {...rest} />
}
