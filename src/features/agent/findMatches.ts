/**
 * Text matches for the conversation's find bar: case-insensitive ranges over the rendered transcript's text nodes.
 * Matching runs on the DOM (what the reader sees, Markdown already rendered), not on the raw items. Elements marked
 * `data-find-skip` (action rows, the find bar itself) are left out. Matches inside one text node only.
 */

/** More matches than this are not highlighted (and the count reads "999+"). */
export const MAX_FIND_MATCHES = 999

export const FIND_SKIP_ATTR = 'data-find-skip'

export function findRanges(root: Node, query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle || typeof document === 'undefined') return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`[${FIND_SKIP_ATTR}]`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node && ranges.length < MAX_FIND_MATCHES; node = walker.nextNode()) {
    const text = (node.textContent ?? '').toLocaleLowerCase()
    let from = 0
    for (
      let at = text.indexOf(needle, from);
      at >= 0 && ranges.length < MAX_FIND_MATCHES;
      at = text.indexOf(needle, from)
    ) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
      from = at + needle.length
    }
  }
  return ranges
}

/** Next / previous index in a ring of `count` matches (−1 when there are none). */
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

const HIGHLIGHT_ALL = 'agent-find'
const HIGHLIGHT_CURRENT = 'agent-find-current'

interface HighlightRegistry {
  set(name: string, value: unknown): void
  delete(name: string): void
}

/** CSS Custom Highlight API (Chromium / Electron); absent in jsdom, where highlighting is simply skipped. */
function registry(): { highlights: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | undefined {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : undefined
}

/** Paint every match, and the current one stronger (styles: `::highlight(agent-find…)` in styles/tailwind.css). */
export function paintMatches(ranges: Range[], current: number): void {
  const api = registry()
  if (!api) return
  api.highlights.set(HIGHLIGHT_ALL, new api.Highlight(...ranges))
  const active = ranges[current]
  if (active) api.highlights.set(HIGHLIGHT_CURRENT, new api.Highlight(active))
  else api.highlights.delete(HIGHLIGHT_CURRENT)
}

export function clearMatches(): void {
  const api = registry()
  api?.highlights.delete(HIGHLIGHT_ALL)
  api?.highlights.delete(HIGHLIGHT_CURRENT)
}
