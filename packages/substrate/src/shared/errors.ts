/**
 * Substrate error type. Every failure that crosses the facade / RPC boundary is normalised to a
 * SubstrateError so the UI can map `code` to an actionable message (去改密钥 / 重试 / 重新连接).
 */
export type SubstrateErrorCode =
  | 'not_open'
  | 'locked'
  | 'invalid_key'
  | 'not_found'
  | 'unsupported'
  | 'sql_rejected'
  | 'timeout'
  | 'rpc'
  | 'fixture_invalid'
  | 'io'
  | 'cancelled'
  | 'unknown'

export class SubstrateError extends Error {
  readonly code: SubstrateErrorCode

  constructor(code: SubstrateErrorCode, message: string, opts?: { cause?: unknown }) {
    super(message, opts)
    this.name = 'SubstrateError'
    this.code = code
  }
}

export function isSubstrateError(err: unknown): err is SubstrateError {
  return err instanceof SubstrateError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'SubstrateError')
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function toSubstrateError(err: unknown, fallback: SubstrateErrorCode = 'unknown'): SubstrateError {
  if (err instanceof SubstrateError) return err
  if (isSubstrateError(err)) return new SubstrateError(err.code, err.message, { cause: err })
  return new SubstrateError(fallback, errorMessage(err), { cause: err })
}

/** Heuristic used by the facade to tell "wrong key / encrypted" apart from generic failures. */
export function looksLikeLockedError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase()
  return /(密钥|key|cipher|decrypt|locked|not a database|encrypted|sqlcipher)/i.test(msg)
}
