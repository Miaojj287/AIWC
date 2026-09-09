/**
 * Every string injected into model context that is not a user/assistant/tool message must be a
 * ContextFragment: a named, bounded, marker-tagged unit. Rules (enforced by the kernel):
 *   1. render() output is truncated to tokenCap before recording (never silently exceeds).
 *   2. tokenCap <= FRAGMENT_TOKEN_CAP_HARD.
 *   3. marker is a stable text prefix so fragments can be recognised and filtered.
 */
export const FRAGMENT_TOKEN_CAP_HARD = 10_000

export interface ContextFragment {
  /** machine kind, e.g. 'memory_snapshot', 'environment', 'observed_context' */
  readonly kind: string
  /** stable marker line placed at the top of the rendered text, e.g. '<memory_snapshot>' */
  readonly marker: string
  /** upper bound in tokens; must be <= FRAGMENT_TOKEN_CAP_HARD */
  readonly tokenCap: number
  render(): string
}

export interface FragmentBounds {
  kind: string
  tokenCap: number
}

/** Cheap token estimate shared across the codebase (CJK-aware: ~1 token per 1.6 chars). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x30ff) || (c >= 0xff00 && c <= 0xffef)) cjk++
  }
  const other = text.length - cjk
  return Math.ceil(cjk / 1.6 + other / 3.6)
}

/** Truncate text so that estimateTokens(result) <= cap, appending a marker when cut. */
export function truncateToTokens(text: string, cap: number): string {
  if (estimateTokens(text) <= cap) return text
  // binary search on char length (estimate is monotonic in length)
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(text.slice(0, mid)) <= cap) lo = mid
    else hi = mid - 1
  }
  const kept = text.slice(0, Math.max(0, lo - 24))
  return kept + `\n[…已截断 ${text.length - kept.length} 字]`
}

/**
 * Standard way to build a ContextFragment. Enforces the hard cap at construction and truncates on
 * render, so no caller can inject an unbounded string.
 */
export function createFragment(kind: string, marker: string, tokenCap: number, render: () => string): ContextFragment {
  if (!kind || !marker) throw new Error('fragment kind and marker are required')
  if (!Number.isFinite(tokenCap) || tokenCap <= 0 || tokenCap > FRAGMENT_TOKEN_CAP_HARD) {
    throw new Error(`fragment tokenCap must be within (0, ${FRAGMENT_TOKEN_CAP_HARD}]: ${kind}`)
  }
  return {
    kind,
    marker,
    tokenCap,
    render() {
      const body = render()
      const text = body.startsWith(marker) ? body : `${marker}\n${body}`
      return truncateToTokens(text, tokenCap)
    },
  }
}

import type { ThreadId } from './ids'
import type { ThreadOrigin, ThreadSettings } from './ops'

export interface FragmentProviderContext {
  threadId: ThreadId
  origin: ThreadOrigin
  settings: ThreadSettings
  /** text of the current user turn (empty for stable-tier providers) */
  userText: string
}

/**
 * Host-contributed context. 'stable' fragments render into the frozen system-prompt prefix (computed
 * once per thread); 'turn' fragments are appended per turn (relationship profile, observed messages…).
 */
export interface FragmentProvider {
  tier: 'stable' | 'turn'
  provide(ctx: FragmentProviderContext): Promise<ContextFragment[]>
  /**
   * Called by the kernel when a thread's history is discarded (clear / rollback), so a provider that
   * skips re-injecting an unchanged fragment ("the model has already seen this card") knows the model
   * has not seen it any more. Omit it when the provider keeps no per-thread state.
   */
  reset?(threadId: ThreadId): void
}
