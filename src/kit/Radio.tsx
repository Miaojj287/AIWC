import { RadioGroup as RadixRadioGroup } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from './cn'

export type RadioGroupProps = ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>

/**
 * RadioGroup — wraps Radix RadioGroup (arrow keys move + select, roving tabindex).
 * Radios are for forms inside dialogs / popovers (export range, close behaviour); the main
 * interface picks values with Select or SegmentedControl (CLAUDE.md §4.3).
 */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup({ className, ...rest }, ref) {
  return <RadixRadioGroup.Root ref={ref} className={cn('flex flex-col gap-2', className)} {...rest} />
})

export interface RadioProps extends ComponentPropsWithoutRef<typeof RadixRadioGroup.Item> {
  label?: ReactNode
  description?: ReactNode
}

/** Radio — 16 circle; unchecked / hover / checked (5px accent ring) / disabled. Figma 154:693. */
export const Radio = forwardRef<HTMLButtonElement, RadioProps>(function Radio(
  { className, label, description, disabled, id, ...rest },
  ref,
) {
  const dot = (
    <RadixRadioGroup.Item
      ref={ref}
      id={id}
      disabled={disabled}
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-chip border border-(--line-25)',
        'transition-colors duration-(--dur-fast) hover:border-(--line-40)',
        'data-[state=checked]:border-[5px] data-[state=checked]:border-accent',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        'disabled:cursor-not-allowed disabled:opacity-40',
        !label && className,
      )}
      {...rest}
    />
  )
  if (!label) return dot
  return (
    <label className={cn('flex cursor-pointer items-start gap-2', disabled && 'cursor-not-allowed', className)}>
      <span className="pt-px">{dot}</span>
      <span className="flex min-w-0 flex-col gap-0.5 peer-disabled:opacity-40">
        <span className="text-body leading-4 text-fg">{label}</span>
        {description ? <span className="text-caption text-fg-3">{description}</span> : null}
      </span>
    </label>
  )
})
