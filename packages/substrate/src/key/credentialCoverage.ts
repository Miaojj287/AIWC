import { join, relative, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { findSessionDbCandidates, resolveDbStoragePath } from '../wcdb/dbFiles'
import { credentialDatabaseFiles } from './credentialFiles'
import { createDbKeyResolver } from './dbKeyResolver'

export interface CredentialCoverageOptions {
  dbRoot: string
  wxid: string
  dbKeyHex?: string
  dbCredentials?: WechatDbCredentialBundle
}

export interface CredentialCoverage {
  database: boolean
  matched: number
  total: number
  missing: string[]
}

/** Report per-account authenticated coverage without exposing saved key material or reading a process. */
export function inspectDbCredentials(opts: CredentialCoverageOptions): CredentialCoverage {
  const discovered = resolveDbStoragePath(opts.dbRoot, opts.wxid)
  if (!discovered) return { database: false, matched: 0, total: 0, missing: [] }
  const storage = realpathSync(discovered)
  const files = credentialDatabaseFiles(storage)
  const sessions = new Set(findSessionDbCandidates(storage))
  const resolver = createDbKeyResolver({
    accountId: opts.wxid,
    dbStoragePath: storage,
    sessionKeyHex: opts.dbKeyHex ?? '',
    dbCredentials: opts.dbCredentials,
  })
  for (const entry of opts.dbCredentials?.entries ?? []) {
    const saved = join(storage, ...entry.relativePath.split('/'))
    if (!files.includes(saved)) files.push(saved)
  }
  const status: CredentialCoverage = { database: false, matched: 0, total: files.length, missing: [] }
  try {
    for (const file of files) {
      if (resolver.keyFor(file) === undefined) status.missing.push(relative(storage, file).split(sep).join('/'))
      else {
        status.matched += 1
        if (sessions.has(file)) status.database = true
      }
    }
    return status
  } finally {
    resolver.clear()
  }
}
