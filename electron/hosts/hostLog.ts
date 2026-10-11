/**
 * Log plumbing for the utility-process hosts. A host has no logger of its own: it posts lines to the
 * main process, which writes them into the app log. Meta is flattened to a bounded string here — the
 * port only carries structured-cloneable values, and these lines run on every database refresh.
 */
export type HostLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface HostLogLine {
  type: 'log'
  level: HostLogLevel
  message: string
  meta?: string
}

/** Longest meta text one line may carry; anything longer belongs in a dedicated diagnostic. */
const MAX_META_CHARS = 500

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // Circular or otherwise unserialisable meta still deserves a line in the log.
    return String(value)
  }
}

/** The text form of a log line's meta, or undefined when there is none. */
export function describeLogMeta(meta: unknown): string | undefined {
  if (meta === undefined) return undefined
  const text =
    meta instanceof Error ? `${meta.name}: ${meta.message}` : typeof meta === 'string' ? meta : stringify(meta)
  return text.length > MAX_META_CHARS ? `${text.slice(0, MAX_META_CHARS)}…` : text
}

/**
 * A logger shaped like the packages' injected loggers (`(level, message, meta?)`), forwarding to the
 * parent process. Without it every `logger?.(…)` inside the substrate is a no-op in production.
 */
export function createHostLogger(post: (line: HostLogLine) => void) {
  return (level: HostLogLevel, message: string, meta?: unknown): void => {
    const described = describeLogMeta(meta)
    post(described === undefined ? { type: 'log', level, message } : { type: 'log', level, message, meta: described })
  }
}
