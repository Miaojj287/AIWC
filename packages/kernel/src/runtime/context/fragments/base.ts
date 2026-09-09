/**
 * Fragment helpers. Every injected string is a ContextFragment; rendering ALWAYS truncates to tokenCap
 * before the text becomes a history item (ARCHITECTURE §5.3).
 *
 * createFragment / truncateToTokens are the @aiwc/protocol implementations (fragments.ts) — the runtime
 * re-exports rather than shipping its own copy (PACKAGE-API 补充约定).
 */
import {
  createFragment,
  estimateTokens,
  FRAGMENT_TOKEN_CAP_HARD,
  newItemId,
  truncateToTokens,
  type ContextFragment,
  type ContextFragmentItem,
  type TurnId,
} from '@aiwc/protocol'

export { createFragment, truncateToTokens }

/** Tail appended by the protocol truncateToTokens when it cuts a text. */
const TRUNCATION_TAIL_RE = /\n\[…已截断 \d+ 字\]$/

export interface RenderedFragment {
  kind: string
  marker: string
  text: string
  tokenEstimate: number
  truncated: boolean
}

/**
 * Render + enforce the cap. The marker line is always kept at the top. Fragments built with the protocol
 * createFragment already truncate in render(); the cap is enforced here again for providers that hand in a
 * bare ContextFragment object.
 */
export function renderFragment(fragment: ContextFragment): RenderedFragment {
  if (fragment.tokenCap > FRAGMENT_TOKEN_CAP_HARD) {
    throw new Error(`fragment ${fragment.kind}: tokenCap ${fragment.tokenCap} exceeds hard cap ${FRAGMENT_TOKEN_CAP_HARD}`)
  }
  const body = fragment.render()
  const withMarker = body.startsWith(fragment.marker) ? body : `${fragment.marker}\n${body}`
  const text = truncateToTokens(withMarker, fragment.tokenCap)
  // a protocol-built fragment already truncated inside render(): detect its tail rather than compare lengths
  const truncated = text !== withMarker || TRUNCATION_TAIL_RE.test(text)
  return { kind: fragment.kind, marker: fragment.marker, text, tokenEstimate: estimateTokens(text), truncated }
}

export function fragmentToItem(fragment: ContextFragment, turnId: TurnId | null, at: number): ContextFragmentItem | undefined {
  const r = renderFragment(fragment)
  const bodyOnly = r.text.slice(r.marker.length).trim()
  if (!bodyOnly) return undefined
  return {
    type: 'context_fragment',
    id: newItemId(),
    turnId,
    createdAt: at,
    kind: r.kind,
    marker: r.marker,
    text: r.text,
    tokenEstimate: r.tokenEstimate,
  }
}
