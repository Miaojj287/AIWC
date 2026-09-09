import { describe, expect, it } from 'vitest'
import { cn } from './cn'

/*
 * The gallery forces hover / pressed states by appending a token class; the components' own state
 * classes must yield to it. That relies on tailwind-merge treating `bg-(--fill-13)` /
 * `border-(--line-16)` as the same class groups as `bg-line-8` / `border-line-8`.
 */
describe('cn', () => {
  it('lets a var-shorthand ground override a themed ground in the same group', () => {
    expect(cn('bg-line-8 text-fg', 'bg-(--fill-13)')).toBe('text-fg bg-(--fill-13)')
    expect(cn('bg-(--fill-20) hover:bg-(--fill-28)', 'bg-(--fill-28)')).toBe('hover:bg-(--fill-28) bg-(--fill-28)')
  })

  it('lets a var-shorthand border colour override a themed border colour but keep the width', () => {
    expect(cn('border border-line-8', 'border-(--line-16)')).toBe('border border-(--line-16)')
    expect(cn('border border-(--line-25) hover:border-(--line-40)', 'border-(--line-40)')).toBe(
      'border hover:border-(--line-40) border-(--line-40)',
    )
  })

  it('keeps different variants of the same group side by side', () => {
    expect(cn('border-line-8 hover:border-(--line-16)')).toBe('border-line-8 hover:border-(--line-16)')
    expect(cn('bg-line-8 hover:bg-(--fill-13) active:bg-(--line-16)')).toBe('bg-line-8 hover:bg-(--fill-13) active:bg-(--line-16)')
  })

  it('merges the registered token scales as their own groups (font size vs colour, radius)', () => {
    expect(cn('text-body text-fg', 'text-fg-3')).toBe('text-body text-fg-3')
    expect(cn('text-body text-fg', 'text-caption')).toBe('text-fg text-caption')
    expect(cn('rounded-card', 'rounded-control')).toBe('rounded-control')
    expect(cn('shadow-overlay', 'shadow-toast')).toBe('shadow-toast')
  })
})
