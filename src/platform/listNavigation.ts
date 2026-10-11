/**
 * Arrow-key movement inside a list of kit rows (`.kit-row` with a tabindex, i.e. interactive ListItems). Attach
 * `onKeyDown={listKeyNav}` to the scrolling container: ↑ / ↓ move focus to the neighbouring row, Home / End to the
 * first / last mounted row, and the browser scrolls the focused row into view. Virtualised lists navigate the rows
 * they have mounted, which is every row near the viewport.
 */
import type { KeyboardEvent } from 'react'

const ROW_SELECTOR = '.kit-row[tabindex]'

export function listKeyNav(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = event.target as HTMLElement | null
  // Typing in a search box or a field inside the list keeps its own arrow keys.
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (row) => row.getAttribute('aria-disabled') !== 'true',
  )
  if (rows.length === 0) return
  const current = rows.findIndex((row) => row === target || row.contains(target))
  let next: number
  switch (event.key) {
    case 'Home':
      next = 0
      break
    case 'End':
      next = rows.length - 1
      break
    case 'ArrowDown':
      next = current < 0 ? 0 : Math.min(rows.length - 1, current + 1)
      break
    default:
      next = current < 0 ? rows.length - 1 : Math.max(0, current - 1)
  }
  const row = rows[next]
  if (!row || row === target) {
    if (row) event.preventDefault()
    return
  }
  event.preventDefault()
  row.focus()
  row.scrollIntoView?.({ block: 'nearest' })
}
