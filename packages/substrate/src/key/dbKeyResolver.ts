/**
 * Resolves the SQLCipher key for one database file.
 *
 * On macOS WeChat hands out one passphrase per account and it opens every database (PBKDF2 is applied
 * per file with that file's own salt), so the key onboarding stored is the answer everywhere. On
 * Windows WeChat configures WCDB **per database**: `session.db`, `contact.db` and every message shard
 * carry a different already-derived key. The stored key then only opens the database it was verified
 * against, and the rest have to be matched against the keys WeChat has in memory.
 *
 * Candidates are collected once and matched locally against each file's first page, which costs a
 * single AES block per candidate — walking the process again for every message shard would cost
 * seconds each.
 */
import { classifyKeyAgainstPage, readFirstPage } from './sqlcipherPage'

/** How long a database no candidate could open stays "unknown" before it is tried again. */
const RETRY_AFTER_MS = 30_000
/** Minimum gap between two walks of the WeChat process. */
const RECOLLECT_AFTER_MS = 5_000

export interface DbKeyResolverDeps {
  /** The key the account was verified with; tried first for every database. */
  sessionKeyHex: string
  /** Keys WeChat currently has configured. Only called for a database the stored key cannot open. */
  collectCandidates: () => readonly string[]
  now?: () => number
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface DbKeyResolver {
  /** The key that decrypts `dbPath`, or undefined when none of the known keys fit. */
  keyFor(dbPath: string): string | undefined
}

export function createDbKeyResolver(deps: DbKeyResolverDeps): DbKeyResolver {
  const now = deps.now ?? Date.now
  const resolved = new Map<string, string>()
  const missedAt = new Map<string, number>()
  let candidates: readonly string[] = []
  let collectedAt = 0

  const fits = (page: Buffer, keyHex: string): boolean => classifyKeyAgainstPage(page, keyHex) !== null
  const collect = (): void => {
    candidates = deps.collectCandidates()
    collectedAt = now()
  }

  return {
    keyFor(dbPath: string): string | undefined {
      const cached = resolved.get(dbPath)
      if (cached) return cached
      const missed = missedAt.get(dbPath)
      if (missed !== undefined && now() - missed < RETRY_AFTER_MS) return undefined

      const page = readFirstPage(dbPath)
      if (!page) return undefined
      if (fits(page, deps.sessionKeyHex)) {
        resolved.set(dbPath, deps.sessionKeyHex)
        return deps.sessionKeyHex
      }

      // Per-database keys (Windows): match this file against everything WeChat has in memory.
      if (collectedAt === 0) collect()
      let match = candidates.find((candidate) => fits(page, candidate))
      if (!match && now() - collectedAt >= RECOLLECT_AFTER_MS) {
        // WeChat may have opened this database after the last walk.
        collect()
        match = candidates.find((candidate) => fits(page, candidate))
      }
      if (!match) {
        deps.logger?.('warn', '[key] no key matches this database', { dbPath, candidates: candidates.length })
        missedAt.set(dbPath, now())
        return undefined
      }
      resolved.set(dbPath, match)
      missedAt.delete(dbPath)
      return match
    },
  }
}
