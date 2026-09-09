import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** e.g. "⌘N" or "⌘⇧T" — rendered in the Latin face. */
  keys: string
}

/** Kbd — key-cap pill for shortcuts in tooltips and menus (Figma 154:920). */
export function Kbd({ keys, className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 items-center rounded-sm bg-line-8 px-[5px] font-latin text-micro font-medium leading-none text-fg-3',
        className,
      )}
      {...rest}
    >
      {keys}
    </kbd>
  )
}
