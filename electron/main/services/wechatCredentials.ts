import { WechatDbCredentialBundleSchema, type WechatDbCredentialBundle } from '@aiwc/protocol'
import type { AccountCredentials } from './accountSession'
import { SECRET_REFS } from '../config/secretStore'

/** Private credential reads remain within the owning account's secret store. */
export function readWechatCredentials(
  credentials: AccountCredentials,
  accountId: string,
): {
  dbKeyHex?: string
  dbCredentials?: WechatDbCredentialBundle
} {
  const account = credentials.config.get().account
  if (account.wxid !== accountId) return {}
  const dbKeyHex = account.dbKeyRef ? (credentials.secrets.reveal(account.dbKeyRef) ?? undefined) : undefined
  if (account.dbCredentialsRef !== SECRET_REFS.dbCredentials) return { dbKeyHex }
  const raw = credentials.secrets.reveal(SECRET_REFS.dbCredentials)
  if (!raw) return { dbKeyHex }
  try {
    const parsed = WechatDbCredentialBundleSchema.safeParse(JSON.parse(raw))
    if (parsed.success && parsed.data.accountId === accountId) return { dbKeyHex, dbCredentials: parsed.data }
  } catch {
    // An invalid encrypted bundle is unavailable; explicit reconnect replaces it.
  }
  return { dbKeyHex }
}

/** Commit only authenticated database material and invalidate stale reader snapshots. */
export function saveWechatDatabase(
  credentials: AccountCredentials,
  target: { wxid: string; dbRoot: string },
  database: {
    dbKeyHex: string
    dbCredentials?: WechatDbCredentialBundle
    currentPaths?: string[]
  },
): void {
  if (database.dbCredentials) {
    const bundle = WechatDbCredentialBundleSchema.parse(database.dbCredentials)
    if (bundle.accountId !== target.wxid) throw new Error('WECHAT_CREDENTIAL_ACCOUNT_MISMATCH')
    const existing = readWechatCredentials(credentials, target.wxid).dbCredentials
    const current = database.currentPaths ? new Set(database.currentPaths) : undefined
    const updated = new Map(
      existing?.entries
        .filter((entry) => !current || current.has(entry.relativePath))
        .map((entry) => [entry.relativePath, entry]),
    )
    for (const entry of bundle.entries) updated.set(entry.relativePath, entry)
    const merged = WechatDbCredentialBundleSchema.parse({ ...bundle, entries: [...updated.values()] })
    credentials.secrets.set(SECRET_REFS.dbCredentials, JSON.stringify(merged))
  } else {
    credentials.secrets.set(SECRET_REFS.dbKey, database.dbKeyHex)
    credentials.secrets.delete(SECRET_REFS.dbCredentials)
  }
  const account = credentials.config.get().account
  credentials.config.set({
    account: {
      ...target,
      dbKeyRef: database.dbCredentials ? null : SECRET_REFS.dbKey,
      dbCredentialsRef: database.dbCredentials ? SECRET_REFS.dbCredentials : null,
      credentialRevision: (account.credentialRevision ?? 0) + 1,
      verifiedAt: 0,
    },
  })
}
