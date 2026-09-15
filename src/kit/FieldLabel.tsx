import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { HelpTip } from './HelpTip'
import { ICON_SIZE, ICON_STROKE, type IconComponent } from './icon'
import { InlineHint, type InlineHintKind } from './InlineHint'

export interface FieldLabelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: IconComponent
  label: ReactNode
  /** Tooltip behind the ? glyph. */
  help?: ReactNode
  /** One-line hint after the name (11.5 weak). */
  hint?: ReactNode
  /** Right-aligned status: an InlineHint kind + text, or any node (Badge). */
  status?: { kind: InlineHintKind; text: ReactNode } | ReactNode
  htmlFor?: string
  required?: boolean
}

const isHintStatus = (s: FieldLabelProps['status']): s is { kind: InlineHintKind; text: ReactNode } =>
  typeof s === 'object' && s !== null && 'kind' in s && 'text' in s

/**
 * FieldLabel — the wizard / settings field header (DESIGN-SPEC §5): icon 13 + name 12.5 Medium + ? tooltip
 * + hint 11.5 weak, status on the right (已自动获取 / 未验证 …). Put the Input row directly below.
 */
export function FieldLabel({
  icon: Icon,
  label,
  help,
  hint,
  status,
  htmlFor,
  required = false,
  className,
  ...rest
}: FieldLabelProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)} {...rest}>
      {Icon ? (
        <Icon size={ICON_SIZE.input} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      ) : null}
      <label htmlFor={htmlFor} className="shrink-0 text-tab font-medium leading-4 text-fg-2">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      {help ? (
        <HelpTip content={help} size={ICON_SIZE.menuAux} subject={typeof label === 'string' ? label : undefined} />
      ) : null}
      {hint ? <span className="min-w-0 flex-1 truncate text-note text-fg-3">{hint}</span> : <span className="flex-1" />}
      {isHintStatus(status) ? (
        <InlineHint kind={status.kind} truncate className="max-w-[60%]">
          {status.text}
        </InlineHint>
      ) : status ? (
        <span className="shrink-0">{status}</span>
      ) : null}
    </div>
  )
}
