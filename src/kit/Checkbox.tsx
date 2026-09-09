import { Check, Minus } from 'lucide-react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from './cn'

export type CheckedState = RadixCheckbox.CheckedState

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof RadixCheckbox.Root> {
  /** Optional inline label rendered to the right (13px). */
  label?: ReactNode
  /** Secondary text under the label (12px, weak). */
  description?: ReactNode
}

/**
 * Checkbox — 16×16 r4; unchecked / hover / checked / indeterminate / disabled.
 * Figma 154:678. `checked` accepts `true | false | 'indeterminate'`.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, disabled, ...rest },
  ref,
) {
  const box = (
    <RadixCheckbox.Root
      ref={ref}
      id={id}
      disabled={disabled}
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-(--line-25)',
        'transition-colors duration-(--dur-fast) hover:border-(--line-40) hover:bg-line-8',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:hover:bg-accent',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        'disabled:cursor-not-allowed disabled:opacity-40',
        !label && className,
      )}
      {...rest}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-(--fg-on-accent)">
        {rest.checked === 'indeterminate' ? (
          <Minus size={11} strokeWidth={2.5} aria-hidden />
        ) : (
          <Check size={11} strokeWidth={2.5} aria-hidden />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
  if (!label) return box
  return (
    <label className={cn('flex cursor-pointer items-start gap-2', disabled && 'cursor-not-allowed', className)}>
      <span className="pt-px">{box}</span>
      <span className="flex min-w-0 flex-col gap-0.5 peer-disabled:opacity-40">
        <span className="text-body leading-4 text-fg">{label}</span>
        {description ? <span className="text-caption text-fg-3">{description}</span> : null}
      </span>
    </label>
  )
})
