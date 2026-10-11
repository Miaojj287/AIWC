/**
 * Regions that claim a shortcut while the user works inside them, so one key means one thing at a time:
 *   - find scope (`data-find-scope`): ⌘F searches the region that holds keyboard focus (the Agent conversation)
 *     instead of the active workspace tab;
 *   - quote scope (`data-quote-scope` + `data-quote-kind/id/label`): ⌘⇧A quotes the text selected inside the region,
 *     with the region's object (a chat, a file) as its source, instead of the whole tab.
 * Pure DOM reads; the attributes are set by the owning feature.
 */

export const FIND_SCOPE_ATTR = 'data-find-scope'
export const QUOTE_SCOPE_ATTR = 'data-quote-scope'

/** Spread on a region's root: `<div {...findScopeProps('agent')}>`. */
export const findScopeProps = (scope: string) => ({ [FIND_SCOPE_ATTR]: scope })

export interface QuoteSource {
  kind: 'session' | 'file' | 'contact'
  id: string
  label: string
}

/** Spread on a quotable region's root; without a source the quote carries no @ chip (the Agent's own transcript). */
export function quoteScopeProps(source?: QuoteSource): Record<string, string> {
  return source
    ? {
        [QUOTE_SCOPE_ATTR]: '',
        'data-quote-kind': source.kind,
        'data-quote-id': source.id,
        'data-quote-label': source.label,
      }
    : { [QUOTE_SCOPE_ATTR]: '' }
}

/** The find scope holding keyboard focus right now, if any. */
export function focusedFindScope(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const el = document.activeElement
  if (!(el instanceof Element)) return undefined
  return el.closest(`[${FIND_SCOPE_ATTR}]`)?.getAttribute(FIND_SCOPE_ATTR) ?? undefined
}

const QUOTE_KINDS: ReadonlySet<string> = new Set(['session', 'file', 'contact'])

/** Non-blank text selected entirely inside one quote scope, with that scope's source object. */
export function selectedQuote(): { text: string; source?: QuoteSource } | undefined {
  if (typeof document === 'undefined') return undefined
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined
  const text = sel.toString()
  if (!text.trim()) return undefined
  const range = sel.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const scope = start?.closest(`[${QUOTE_SCOPE_ATTR}]`)
  if (!scope || !scope.contains(range.endContainer)) return undefined
  const kind = scope.getAttribute('data-quote-kind')
  const id = scope.getAttribute('data-quote-id')
  const label = scope.getAttribute('data-quote-label')
  const source =
    kind && QUOTE_KINDS.has(kind) && id ? { kind: kind as QuoteSource['kind'], id, label: label ?? id } : undefined
  return { text, source }
}
