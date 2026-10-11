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
  /** 'round' = the 18px circle of a notes-style checklist (每日待办); default the 16px r4 square. */
  shape?: 'square' | 'round'
}

/**
 * Checkbox — 16×16 r4; unchecked / hover / checked / indeterminate / disabled.
 * Figma 154:678. `checked` accepts `true | false | 'indeterminate'`. `shape="round"` is the checklist circle.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, disabled, shape = 'square', ...rest },
  ref,
) {
  const box = (
    <RadixCheckbox.Root
      ref={ref}
      id={id}
      disabled={disabled}
      className={cn(
        'peer inline-flex shrink-0 items-center justify-center border border-(--line-25)',
        shape === 'round' ? 'size-4.5 rounded-chip' : 'size-4 rounded-sm',
        'transition-colors enabled:hover:border-(--line-40) enabled:hover:bg-hover-7 enabled:active:bg-(--fill-13)',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:enabled:hover:bg-accent-hover data-[state=checked]:enabled:active:bg-accent-active',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:enabled:hover:bg-accent-hover',
        'outline-none',
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
