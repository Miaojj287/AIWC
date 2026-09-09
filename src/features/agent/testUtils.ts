/**
 * Test-only helpers (imported by *.test.tsx, never by app code).
 *
 * jsdom + nwsapi resolve the `:modal` / `:popover-open` pseudo-classes by recursing through every
 * ancestor, which floating-ui's `isTopLayer()` triggers for each positioned popover. With a moderately
 * deep tree that recursion takes seconds per render. Neither selector can ever match in jsdom (it has
 * no top layer), so answering `false` up front is behaviour-preserving and makes popover tests fast.
 */
export function patchJsdomTopLayerMatches(): () => void {
  const native = Element.prototype.matches
  Element.prototype.matches = function patched(this: Element, selectors: string): boolean {
    if (selectors === ':modal' || selectors === ':popover-open' || selectors === ':fullscreen') return false
    return native.call(this, selectors)
  }
  return () => {
    Element.prototype.matches = native
  }
}
