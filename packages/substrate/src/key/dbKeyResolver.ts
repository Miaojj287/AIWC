/**
 * Resolves saved SQLCipher credentials for one account without accessing the WeChat process.
 * WeChat 4.1.15 on macOS keeps masked, already-derived keys per database; a cached session key alone
 * therefore cannot open the contact database or message shards (see WECHAT-LOGIN-KEY-RESEARCH.md).
 */
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { WechatDbCredentialBundleSchema, type WechatDbCredentialBundle } from '@aiwc/protocol'
import { SubstrateError } from '../shared/errors'
import { deriveSqlcipherHmacKey, pageHmacMatches, resolvePageCipher, type PageCipher } from '../wcdb/sqlcipherCodec'
import {
  decryptFirstPageBody,
  deriveSqlcipherKey,
  isPlaintextSqlitePage,
  isValidKeyHex,
  looksLikeSqliteHeaderBody,
  readFirstPage,
  SQLCIPHER_SALT_SIZE,
} from './sqlcipherPage'

export interface DbKeyResolverDeps {
  accountId: string
  dbStoragePath: string
  /** Legacy credential. It is authenticated separately against every database. */
  sessionKeyHex: string
  dbCredentials?: WechatDbCredentialBundle
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export interface DbKeyResolver {
  /** The saved key authenticated for `dbPath`, or undefined when the file remains locked. */
  keyFor(dbPath: string): string | undefined
  /** Erase derived key buffers and account-local resolution caches on reader shutdown. */
  clear(): void
}

interface ResolvedCredential {
  keyHex: string
  cipher: PageCipher
}

type DbCredential = WechatDbCredentialBundle['entries'][number]

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function checkedBundle(deps: DbKeyResolverDeps): WechatDbCredentialBundle | undefined {
  if (!deps.dbCredentials) return undefined
  const parsed = WechatDbCredentialBundleSchema.safeParse(deps.dbCredentials)
  if (!parsed.success || parsed.data.accountId !== deps.accountId)
    throw new SubstrateError('invalid_key', 'WECHAT_DATABASE_CREDENTIALS_INVALID')
  return parsed.data
}

function cipherForCredential(page: Buffer, entry: DbCredential): PageCipher | null {
  const salt = page.subarray(0, SQLCIPHER_SALT_SIZE)
  const input = Buffer.from(entry.keyHex, 'hex')
  const key = entry.form === 'direct' ? input : deriveSqlcipherKey(input, salt)
  if (key !== input) input.fill(0)
  const hmacKey = deriveSqlcipherHmacKey(key, salt)
  const body = decryptFirstPageBody(page, key)
  const isAuthenticated = !!body && looksLikeSqliteHeaderBody(body) && pageHmacMatches(hmacKey, page, 1)
  body?.fill(0)
  if (!isAuthenticated) {
    key.fill(0)
    hmacKey.fill(0)
    return null
  }
  return { key, hmacKey, form: entry.form, saltHex: salt.toString('hex') }
}

/** Bind account credentials to normalized paths, salts, and authenticated SQLCipher pages. */
export function createDbKeyResolver(deps: DbKeyResolverDeps): DbKeyResolver {
  const bundle = checkedBundle(deps)
  const root = resolve(deps.dbStoragePath)
  const realRoot = realpathSync(root)
  const credentials = new Map(bundle?.entries.map((entry) => [entry.relativePath, entry]))
  const resolved = new Map<string, ResolvedCredential>()
  const legacyKeyHex = deps.sessionKeyHex.trim().toLowerCase()

  const erase = (path: string): void => {
    const cached = resolved.get(path)
    cached?.cipher.key.fill(0)
    cached?.cipher.hmacKey?.fill(0)
    resolved.delete(path)
  }
  const pathWithinRoot = (dbPath: string): string | undefined => {
    const absolutePath = resolve(dbPath)
    const lexicalRoot = isWithin(root, absolutePath) ? root : realRoot
    if (!isWithin(lexicalRoot, absolutePath)) return undefined
    try {
      if (!isWithin(realRoot, realpathSync(absolutePath))) return undefined
    } catch {
      deps.logger?.('debug', '[key] database path unavailable')
      return undefined
    }
    return relative(lexicalRoot, absolutePath).split(sep).join('/')
  }

  return {
    keyFor(dbPath): string | undefined {
      const path = pathWithinRoot(dbPath)
      if (!path) return undefined
      const page = readFirstPage(dbPath)
      if (!page) return undefined
      const entry = credentials.get(path)
      if (isPlaintextSqlitePage(page)) return !entry && isValidKeyHex(legacyKeyHex) ? legacyKeyHex : undefined
      const salt = page.subarray(0, SQLCIPHER_SALT_SIZE).toString('hex')
      // An explicit file credential is immutable until a new acquisition. Falling back to an old
      // account key after a salt change would hide that WeChat replaced this database.
      if (entry && entry.saltHex !== salt) {
        erase(path)
        return undefined
      }
      const cached = resolved.get(path)
      if (cached?.cipher.saltHex === salt)
        return cached.cipher.hmacKey && pageHmacMatches(cached.cipher.hmacKey, page, 1) ? cached.keyHex : undefined
      erase(path)
      const keyHex = entry?.keyHex ?? legacyKeyHex
      const cipher = entry ? cipherForCredential(page, entry) : resolvePageCipher(page, keyHex)
      if (!cipher?.hmacKey) {
        cipher?.key.fill(0)
        return undefined
      }
      resolved.set(path, { keyHex, cipher })
      return keyHex
    },
    clear(): void {
      for (const path of resolved.keys()) erase(path)
    },
  }
}
