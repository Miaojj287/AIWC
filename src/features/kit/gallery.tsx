/**
 * Gallery scaffolding — mirrors the Figma component board layout (154:415):
 * Section = ① title 14 Medium + description 12 weak; Item = 11px caption + samples; State = sample + 11px state name.
 */
import type { ReactNode } from 'react'
import { cn } from '@/kit'

export function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-bubble font-medium text-fg">
          {title}
        </h2>
        <p className="text-caption text-fg-3">{description}</p>
      </div>
      <div className="flex flex-wrap items-start gap-7">{children}</div>
    </section>
  )
}

export function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="text-micro text-fg-3">{label}</div>
      {children}
    </div>
  )
}

export function Row({ children, className, align = 'center' }: { children: ReactNode; className?: string; align?: 'center' | 'start' }) {
  return <div className={cn('flex gap-4', align === 'center' ? 'items-center' : 'items-start', className)}>{children}</div>
}

export function State({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)}>
      {children}
      <div className="text-micro text-fg-3">{name}</div>
    </div>
  )
}

export function RowLabel({ children }: { children: ReactNode }) {
  return <div className="w-[60px] shrink-0 font-mono text-micro text-fg-3">{children}</div>
}

/** Forced pseudo-states for static previews. Same tokens as the components' own hover / active rules. */
export const FOCUS_RING = 'ring-2 ring-accent/70'
