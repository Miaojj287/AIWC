import { Tooltip as RadixTooltip } from 'radix-ui'
import { createContext, useContext, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react'
import { cn } from './cn'
import { Kbd } from './Kbd'

const ProviderContext = createContext(false)

export type TooltipProviderProps = ComponentPropsWithoutRef<typeof RadixTooltip.Provider>

/** Mount once at the app root so tooltips share the skip-delay window. */
export function TooltipProvider({ delayDuration = 400, skipDelayDuration = 200, children, ...rest }: TooltipProviderProps) {
  return (
    <ProviderContext.Provider value>
      <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...rest}>
        {children}
      </RadixTooltip.Provider>
    </ProviderContext.Provider>
  )
}

export interface TooltipProps {
  /** Main line, 11.5px. */
  content: ReactNode
  /** Shortcut pill after the text (Figma "带快捷键"). */
  kbd?: string
  /** Second, weaker line (Figma "两行"); makes `content` Medium. */
  description?: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Skip rendering the tooltip entirely (e.g. when the label is already visible). */
  disabled?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  /** The trigger. Must accept a ref and spread props (Button, IconButton, a span…). */
  children: ReactElement
  className?: string
}

/**
 * Tooltip — raised ground, r6, text 11.5, toast shadow (Figma 154:925). Three shapes:
 * text only / text + Kbd / title + description (200px).
 */
export function Tooltip({
  content,
  kbd,
  description,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  disabled = false,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  children,
  className,
}: TooltipProps) {
  const hasProvider = useContext(ProviderContext)
  if (disabled || content === null || content === undefined || content === '') return children

  const tooltip = (
    <RadixTooltip.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(
            'kit-menu z-50 select-none rounded-control bg-raised text-note text-fg shadow-toast',
            description ? 'flex w-[200px] flex-col gap-0.5 px-2 py-1.5' : 'flex items-center gap-1.5 px-2 py-1',
            className,
          )}
        >
          {description ? (
            <>
              <span className="font-medium leading-4">{content}</span>
              <span className="text-micro leading-4 text-fg-2">{description}</span>
            </>
          ) : (
            <>
              <span className="leading-4">{content}</span>
              {kbd ? <Kbd keys={kbd} /> : null}
            </>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )

  // Tooltip works standalone (gallery, tests) but shares timing when the app mounts <TooltipProvider>.
  return hasProvider ? tooltip : <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>{tooltip}</RadixTooltip.Provider>
}
