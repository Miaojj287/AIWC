/**
 * Tiny crash-safe file logger for the main process. Synchronous appends (so a line written right
 * before a crash is on disk), size-based rotation (main.log → main.log.1 … main.log.N), no deps.
 * Pure Node — no `electron` import — so it is unit-testable.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface LoggerOptions {
  /** Absolute path of the active log file, e.g. <dataRoot>/logs/main.log */
  file: string
  /** Rotate when the active file exceeds this many bytes. Default 2 MB. */
  maxBytes?: number
  /** Number of files kept in total (active + rotated). Default 5. */
  maxFiles?: number
  /** Minimum level written. Default 'info'. */
  level?: LogLevel
  /** Also mirror to the console. Default true. */
  console?: boolean
  clock?: () => Date
}

export interface Logger {
  debug(msg: string, meta?: unknown): void
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
  /** Logger with a fixed `[scope]` prefix; shares the same file. */
  child(scope: string): Logger
  readonly file: string
  /** All files that currently exist, newest first. */
  files(): string[]
  setLevel(level: LogLevel): void
}

function safeStringify(value: unknown): string {
  if (value === undefined) return ''
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack })
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatLine(ts: Date, level: LogLevel, scope: string | undefined, msg: string, meta?: unknown): string {
  const scopePart = scope ? ` [${scope}]` : ''
  const metaPart = meta === undefined ? '' : ` ${safeStringify(meta)}`
  return `${ts.toISOString()} ${level.toUpperCase().padEnd(5)}${scopePart} ${msg}${metaPart}\n`
}

export function createLogger(opts: LoggerOptions): Logger {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024
  const maxFiles = Math.max(1, opts.maxFiles ?? 5)
  const clock = opts.clock ?? (() => new Date())
  const mirror = opts.console ?? true
  let minLevel: LogLevel = opts.level ?? 'info'

  try {
    mkdirSync(dirname(opts.file), { recursive: true })
  } catch {
    // best effort; writes will fail loudly below
  }

  const rotatedName = (i: number) => `${opts.file}.${i}`

  function rotate(): void {
    // drop the oldest, shift the rest up by one, then rename the active file to .1
    const oldest = rotatedName(maxFiles - 1)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = maxFiles - 2; i >= 1; i--) {
      const from = rotatedName(i)
      if (existsSync(from)) renameSync(from, rotatedName(i + 1))
    }
    if (maxFiles > 1 && existsSync(opts.file)) renameSync(opts.file, rotatedName(1))
    else if (existsSync(opts.file)) unlinkSync(opts.file)
  }

  function write(level: LogLevel, scope: string | undefined, msg: string, meta?: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return
    const line = formatLine(clock(), level, scope, msg, meta)
    if (mirror) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(line.trimEnd())
    }
    try {
      if (existsSync(opts.file) && statSync(opts.file).size + Buffer.byteLength(line) > maxBytes) rotate()
      appendFileSync(opts.file, line, 'utf8')
    } catch (e) {
      if (mirror) console.error('[log] write failed', e)
    }
  }

  function make(scope?: string): Logger {
    return {
      file: opts.file,
      debug: (m, meta) => write('debug', scope, m, meta),
      info: (m, meta) => write('info', scope, m, meta),
      warn: (m, meta) => write('warn', scope, m, meta),
      error: (m, meta) => write('error', scope, m, meta),
      child: (s) => make(scope ? `${scope}:${s}` : s),
      files: () => {
        const out: string[] = []
        if (existsSync(opts.file)) out.push(opts.file)
        for (let i = 1; i < maxFiles; i++) if (existsSync(rotatedName(i))) out.push(rotatedName(i))
        return out
      },
      setLevel: (l) => {
        minLevel = l
      },
    }
  }

  return make()
}

/** Logger that discards everything — for tests and for code paths before the real logger exists. */
export const nullLogger: Logger = {
  file: '',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
  files: () => [],
  setLevel: () => {},
}
