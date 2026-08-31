export class AIWCError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly exitCode: number

  constructor(code: string, message: string, details?: unknown, exitCode = 1) {
    super(message)
    this.name = 'AIWCError'
    this.code = code
    this.details = details
    this.exitCode = exitCode
  }
}

export function notImplemented(feature: string): AIWCError {
  return new AIWCError('NOT_IMPLEMENTED', `${feature} 尚未移植到 CLI 版。`)
}

export function configMissing(field: string, hint?: string): AIWCError {
  return new AIWCError('CONFIG_MISSING', `缺少配置: ${field}${hint ? `。${hint}` : ''}`)
}

export function invalidArgument(message: string, details?: unknown): AIWCError {
  return new AIWCError('INVALID_ARGUMENT', message, details)
}

export function dbError(message: string, details?: unknown): AIWCError {
  return new AIWCError('DB_ERROR', message, details)
}

export function toAIWCError(error: unknown): AIWCError {
  if (error instanceof AIWCError) return error
  if (error instanceof Error) return new AIWCError('INTERNAL_ERROR', error.message, { name: error.name })
  return new AIWCError('INTERNAL_ERROR', String(error))
}
