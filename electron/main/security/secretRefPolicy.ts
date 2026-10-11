/**
 * Which secret-store refs the renderer may touch through `secret:*` (and point config at). The store also holds
 * main-only credentials — the iLink bot session (`mobile.*`, which decides who counts as the owner), MCP server
 * secrets (`mcp.*`, saved through the extensions service) — so a renderer that could name any ref could read or
 * replace them. Refs are exact keys, so a prefix rule below can never reach a main-only ref.
 * Pure module so it is unit-testable.
 */
import { PROXY_PASSWORD_SECRET_REF } from '@aiwc/protocol'
import { SECRET_REFS } from '../config/secretStore'

/** The WeChat account keys: main's refs (SECRET_REFS) and the renderer's fallback names (accountModel.ts). */
const ACCOUNT_KEY_REFS: ReadonlySet<string> = new Set([
  SECRET_REFS.dbKey,
  SECRET_REFS.imageXorKey,
  SECRET_REFS.imageAesKey,
  'account:dbKey',
  'account:imageXorKey',
  'account:imageAesKey',
])

const FIXED_REFS: ReadonlySet<string> = new Set([SECRET_REFS.jevApiKey, PROXY_PASSWORD_SECRET_REF])

/** Provider API keys: the renderer's `provider:<id>:apiKey` and main's `ai.provider.<id>.apiKey`. */
const PROVIDER_KEY_RE = /^(?:provider:[A-Za-z0-9_.:-]{1,96}:apiKey|ai\.provider\.[A-Za-z0-9_-]{1,96}\.apiKey)$/

/** A provider API key ref — the only kind a provider (in config or an ai:* request) may name. */
export function isProviderKeyRef(ref: unknown): boolean {
  return typeof ref === 'string' && PROVIDER_KEY_RE.test(ref)
}

/** May the renderer set, delete or check this ref? */
export function isRendererSecretRef(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false
  return ACCOUNT_KEY_REFS.has(ref) || FIXED_REFS.has(ref) || PROVIDER_KEY_RE.test(ref)
}

/** May the renderer read this secret in clear? Only the account keys have a 👁 in the UI; API keys never come back. */
export function isRevealableSecretRef(ref: unknown): ref is string {
  return typeof ref === 'string' && ACCOUNT_KEY_REFS.has(ref)
}

interface RefFields {
  ai?: { providers?: ReadonlyArray<{ apiKeyRef?: unknown } | undefined>; jev?: { apiKeyRef?: unknown } }
  account?: { dbKeyRef?: unknown; imageXorKeyRef?: unknown; imageAesKeyRef?: unknown }
}

/**
 * The first secret ref in a config patch that its field may not point at, if any. Each field takes only its own
 * kind: otherwise a provider's apiKeyRef = `mobile.ilink.session` (or the database key) would be sent by 测试连接
 * as an API key to a renderer-chosen URL.
 */
export function refusedSecretRefInPatch(patch: unknown): string | undefined {
  if (!patch || typeof patch !== 'object') return undefined
  const { ai, account } = patch as RefFields
  const checks: Array<[unknown, (ref: unknown) => boolean]> = [
    ...(Array.isArray(ai?.providers) ? ai.providers : []).map((provider): [unknown, (ref: unknown) => boolean] => [
      provider?.apiKeyRef,
      isProviderKeyRef,
    ]),
    [ai?.jev?.apiKeyRef, (ref) => ref === SECRET_REFS.jevApiKey],
    [account?.dbKeyRef, isRevealableSecretRef],
    [account?.imageXorKeyRef, isRevealableSecretRef],
    [account?.imageAesKeyRef, isRevealableSecretRef],
  ]
  const refused = checks.find(([ref, allowed]) => ref !== undefined && !allowed(ref))
  return refused ? String(refused[0]).slice(0, 128) : undefined
}
