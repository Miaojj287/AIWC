import { Switch } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from './cn'

export interface ToggleProps extends ComponentPropsWithoutRef<typeof Switch.Root> {
  /** Accessible name when there is no associated label element. */
  label?: string
}

/**
 * Toggle (Switch) — 36×20 track, 16 thumb. Off / on / hover / focus (2px ring) / disabled 40%.
 * The thumb is flat: shadows belong to floating layers only (CLAUDE.md §2.1), so none here.
 * Figma 154:657. Use for immediate on/off settings (CLAUDE.md §4.3); never a radio.
 */
export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle({ className, label, ...rest }, ref) {
  return (
    <Switch.Root
      ref={ref}
      aria-label={label}
      className={cn(
        'group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-chip p-0.5',
        'bg-(--fill-20) transition-colors duration-(--dur-fast) hover:bg-(--fill-28)',
        'data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent-hover',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <Switch.Thumb
        className={cn(
          'block size-4 rounded-chip bg-(--fg-on-accent)',
          'transition-transform duration-(--dur-fast) data-[state=checked]:translate-x-4',
        )}
      />
    </Switch.Root>
  )
})
