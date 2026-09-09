import { ScrollArea as Radix } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import { cn } from './cn'

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof Radix.Root> {
  children: ReactNode
  viewportClassName?: string
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Forwarded to the viewport (the element that actually scrolls). */
  viewportRef?: React.Ref<HTMLDivElement>
}

/**
 * ScrollArea — thin overlay scrollbar (8px, fill-13, hover fill-20) that appears on hover.
 * Use for the three fixed columns and Tab bodies; plain overflow-auto is fine for small boxes.
 */
export const ScrollArea = forwardRef<ElementRef<typeof Radix.Root>, ScrollAreaProps>(function ScrollArea(
  { children, className, viewportClassName, orientation = 'vertical', viewportRef, type = 'hover', scrollHideDelay = 600, ...rest },
  ref,
) {
  return (
    <Radix.Root ref={ref} type={type} scrollHideDelay={scrollHideDelay} className={cn('relative min-h-0 overflow-hidden', className)} {...rest}>
      <Radix.Viewport ref={viewportRef} className={cn('size-full rounded-[inherit] [&>div]:!block', viewportClassName)}>
        {children}
      </Radix.Viewport>
      {orientation !== 'horizontal' ? <Bar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <Bar orientation="horizontal" /> : null}
      <Radix.Corner />
    </Radix.Root>
  )
})

function Bar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  return (
    <Radix.Scrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-0.5 transition-opacity duration-(--dur-fast)',
        orientation === 'vertical' ? 'h-full w-2' : 'h-2 flex-col',
      )}
    >
      <Radix.Thumb className="relative flex-1 rounded-chip bg-(--fill-13) before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-[24px] before:min-w-[24px] before:-translate-x-1/2 before:-translate-y-1/2 hover:bg-(--fill-20)" />
    </Radix.Scrollbar>
  )
}
