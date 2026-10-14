import { SubstrateError } from '../shared/errors'
import { join } from 'node:path'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import type { DbKeyResolver } from '../key/dbKeyResolver'
import type { WcdbBridge } from './bridge'

/** First authenticated session candidate that the reader engine can open. */
export function pickSessionDatabase(bridge: WcdbBridge, candidates: readonly string[], keys: DbKeyResolver): string {
  let hasCredential = false
  for (const candidate of candidates) {
    const keyHex = keys.keyFor(candidate)
    if (keyHex === undefined) continue
    hasCredential = true
    if (bridge.canOpen(candidate, keyHex)) return candidate
  }
  throw new SubstrateError(
    hasCredential ? 'io' : 'locked',
    hasCredential ? 'WECHAT_DATABASE_OPEN_FAILED' : 'WECHAT_DATABASE_CREDENTIALS_MISSING',
  )
}

/** Refuse partial history before higher-level shard queries can interpret missing keys as empty. */
export function requireDatabaseCredentials(keys: DbKeyResolver, paths: readonly string[]): void {
  for (const path of paths) {
    if (keys.keyFor(path) === undefined) throw new SubstrateError('locked', 'WECHAT_DATABASE_CREDENTIALS_MISSING')
  }
}

/** Previously saved message shards still count as required when the directory was replaced. */
export function savedMessageDatabasePaths(storage: string, bundle?: WechatDbCredentialBundle): string[] {
  return (bundle?.entries ?? [])
    .filter((entry) => /(?:^|\/)(?:(?:msg|message)_\d+|biz_message_\d+)\.db$/i.test(entry.relativePath))
    .map((entry) => join(storage, ...entry.relativePath.split('/')))
}

/** Missing saved contact files remain locked until the selected account is connected again. */
export function savedContactDatabasePaths(storage: string, bundle?: WechatDbCredentialBundle): string[] {
  return (bundle?.entries ?? [])
    .filter((entry) => /(?:^|\/)contact\.db$/i.test(entry.relativePath))
    .map((entry) => join(storage, ...entry.relativePath.split('/')))
}
