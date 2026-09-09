// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Check } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it('renders the five variants with the shared frame classes', () => {
    render(
      <>
        <Button variant="primary">主要</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="outline">描边</Button>
        <Button variant="danger">危险</Button>
        <Button variant="link">链接</Button>
      </>,
    )
    const primary = screen.getByRole('button', { name: '主要' })
    const ghost = screen.getByRole('button', { name: '幽灵' })
    const outline = screen.getByRole('button', { name: '描边' })
    const danger = screen.getByRole('button', { name: '危险' })
    const link = screen.getByRole('button', { name: '链接' })

    expect(primary.className).toContain('bg-accent')
    expect(ghost.className).toContain('bg-line-8')
    expect(outline.className).toContain('border-(--line-16)')
    expect(danger.className).toContain('bg-danger')
    expect(link.className).toContain('text-accent')
    for (const el of [primary, ghost, outline, danger, link]) {
      expect(el.className).toContain('h-[30px]')
      expect(el.className).toContain('rounded-control')
      expect(el.getAttribute('type')).toBe('button')
    }
  })

  it('supports the sm size and a leading icon', () => {
    render(
      <Button size="sm" icon={Check}>
        保存
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '保存' })
    expect(btn.className).toContain('h-[26px]')
    expect(btn.querySelector('svg')).not.toBeNull()
  })

  it('disables and marks busy while loading, swapping the icon for a spinner', () => {
    const onClick = vi.fn()
    render(
      <Button icon={Check} loading onClick={onClick}>
        保存
      </Button>,
    )
    const btn = screen.getByRole('button', { name: /保存/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('respects disabled', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        禁用
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '禁用' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})
