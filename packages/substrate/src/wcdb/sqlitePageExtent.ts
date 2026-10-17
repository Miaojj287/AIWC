import {
  decryptFirstPageBody,
  looksLikeSqliteHeaderBody,
  SQLCIPHER_PAGE_SIZE,
  SQLCIPHER_SALT_SIZE,
} from '../key/sqlcipherPage'
import { pageHmacMatches, type PageCipher } from './sqlcipherCodec'

const CHANGE_COUNTER_OFFSET = 24
const DATABASE_SIZE_OFFSET = 28
const VERSION_VALID_FOR_OFFSET = 92

/** Trust SQLite's logical size only after page authentication; legacy unauthenticated readers use physical size. */
export function authenticatedMainPageCount(
  firstPage: Buffer,
  cipher: PageCipher,
  physicalBytes: number,
): number | undefined {
  if (
    !Number.isSafeInteger(physicalBytes) ||
    physicalBytes < SQLCIPHER_PAGE_SIZE ||
    physicalBytes % SQLCIPHER_PAGE_SIZE !== 0
  )
    return undefined
  if (firstPage.length !== SQLCIPHER_PAGE_SIZE) return undefined
  const physicalPages = physicalBytes / SQLCIPHER_PAGE_SIZE
  if (!cipher.hmacKey) return physicalPages
  if (!pageHmacMatches(cipher.hmacKey, firstPage, 1)) return undefined
  const body = decryptFirstPageBody(firstPage, cipher.key)
  try {
    if (!body || !looksLikeSqliteHeaderBody(body)) return undefined
    const declaredPages = body.readUInt32BE(DATABASE_SIZE_OFFSET - SQLCIPHER_SALT_SIZE)
    const counter = body.readUInt32BE(CHANGE_COUNTER_OFFSET - SQLCIPHER_SALT_SIZE)
    const validFor = body.readUInt32BE(VERSION_VALID_FOR_OFFSET - SQLCIPHER_SALT_SIZE)
    // SQLite fileformat2.html#in_header_database_size: zero or stale counts use the physical extent.
    if (!declaredPages || counter !== validFor) return physicalPages
    return declaredPages <= physicalPages ? declaredPages : undefined
  } finally {
    body?.fill(0)
  }
}
