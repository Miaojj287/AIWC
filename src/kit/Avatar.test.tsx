// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar, avatarInitial, avatarTileIndex, type AvatarMember, type AvatarSize } from './Avatar'

afterEach(cleanup)

const members = (n: number): AvatarMember[] => Array.from({ length: n }, (_, i) => ({ id: `m-${i}`, name: `成员${i + 1}` }))

const mosaicCells = (el: HTMLElement) => Array.from(el.children) as HTMLElement[]

describe('avatarTileIndex / avatarInitial', () => {
  it('maps an id deterministically onto one of the eight tiles', () => {
    for (const id of ['wxid_a', 'wxid_b', '', '群-1', 'x'.repeat(200)]) {
      const idx = avatarTileIndex(id)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(8)
      expect(avatarTileIndex(id)).toBe(idx)
    }
  })

  it('takes the first grapheme, upper-cased for Latin, ? for empty', () => {
    expect(avatarInitial('alex')).toBe('A')
    expect(avatarInitial('  张三')).toBe('张')
    expect(avatarInitial('')).toBe('?')
    expect(avatarInitial('   ')).toBe('?')
  })
})

describe('Avatar (single)', () => {
  it('renders the initial on a hashed tile when there is no image', () => {
    render(<Avatar id="wxid_a" name="alex" />)
    const el = screen.getByRole('img', { name: 'alex' })
    expect(el.textContent).toBe('A')
    expect(el.style.backgroundImage).toBe(`var(--avatar-tile-${avatarTileIndex('wxid_a')})`)
    expect(el.style.width).toBe('36px')
  })

  it('falls back to the initial when the image fails to load', () => {
    render(<Avatar id="wxid_a" name="alex" src="/nonexistent.png" />)
    const el = screen.getByRole('img', { name: 'alex' })
    expect(el.textContent).toBe('')
    fireEvent.error(el.querySelector('img') as HTMLImageElement)
    expect(el.textContent).toBe('A')
  })

  it('sizes the initial with type-scale classes only (no text-[Npx])', () => {
    const expected: Record<AvatarSize, string> = { 20: 'text-micro', 28: 'text-caption', 36: 'text-bubble', 44: 'text-title', 56: 'text-wizard', 64: 'text-wizard' }
    for (const size of Object.keys(expected).map(Number) as AvatarSize[]) {
      const { unmount } = render(<Avatar id="wxid_a" name="alex" size={size} />)
      const cls = screen.getByRole('img', { name: 'alex' }).className
      expect(cls, `size ${size}`).toContain(expected[size])
      expect(cls).not.toMatch(/text-\[/)
      expect(cls).not.toMatch(/\btext-white\b/)
      unmount()
    }
  })
})

describe('Avatar (group mosaic)', () => {
  it('lays out up to 4 members as 2×2 and 5–9 as 3×3, capped at nine cells', () => {
    const cases: Array<[number, number, number]> = [[1, 1, 1], [3, 2, 3], [4, 2, 4], [5, 3, 5], [9, 3, 9], [14, 3, 9]]
    for (const [count, cols, cells] of cases) {
      const { unmount } = render(<Avatar id="g" name="群" members={members(count)} />)
      const el = screen.getByRole('img', { name: '群' })
      expect(el.style.gridTemplateColumns, `${count} members`).toBe(`repeat(${cols}, minmax(0, 1fr))`)
      expect(mosaicCells(el)).toHaveLength(cells)
      unmount()
    }
  })

  it('puts no text in any cell — tiles or images only, r4 corners', () => {
    render(<Avatar id="g" name="群" members={members(9)} size={64} />)
    const el = screen.getByRole('img', { name: '群' })
    expect(el.textContent).toBe('')
    for (const cell of mosaicCells(el)) {
      expect(cell.textContent).toBe('')
      expect(cell.className).toContain('rounded-sm')
      expect(cell.className).not.toMatch(/rounded-\[|text-\[/)
      expect(cell.style.backgroundImage).toMatch(/^var\(--avatar-tile-[0-7]\)$/)
    }
  })

  it('shows a member image when provided and drops to the tile when it breaks', () => {
    const list = members(4)
    list[0] = { ...list[0]!, src: '/member.png' }
    render(<Avatar id="g" name="群" members={list} />)
    const [first] = mosaicCells(screen.getByRole('img', { name: '群' }))
    const img = first!.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(first!.style.backgroundImage).toBe('')
    fireEvent.error(img)
    expect(first!.querySelector('img')).toBeNull()
    expect(first!.style.backgroundImage).toBe(`var(--avatar-tile-${avatarTileIndex('m-0')})`)
    expect(first!.textContent).toBe('')
  })
})


it('prefers the database group image and retries an updated URL after failure', () => {
  const { container, rerender } = render(<Avatar id="g" name="群" src="/group.png" members={members(3)} />)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/group.png')
  fireEvent.error(container.querySelector('img')!)
  rerender(<Avatar id="g" name="群" src="/updated.png" members={members(3)} />)
  expect(container.querySelector('img')?.getAttribute('src')).toBe('/updated.png')
})
