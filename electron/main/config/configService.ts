/**
 * Persistent app configuration: load → validate (AppConfigSchema, zod prefault defaults) → atomic
 * save; `set(patch)` deep-merges, re-validates, saves and notifies subscribers. Pure module (paths
 * injected, no `electron` import) so it is unit-testable.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppConfigSchema, type AppConfig, type ConfigPatch, defaultConfig } from '@aiwc/protocol'
import type { Logger } from '../log'
import { nullLogger } from '../log'
import { t } from '../i18n'

export interface ConfigService {
  get(): AppConfig
  /** Deep-merge `patch`, validate, persist, notify. Throws (and keeps the old config) when invalid. */
  set(patch: ConfigPatch): AppConfig
  /** Replace the whole config (used by import / reset). */
  replace(next: unknown): AppConfig
  subscribe(listener: (next: AppConfig, prev: AppConfig) => void): () => void
  readonly file: string
}

export interface ConfigServiceOptions {
  file: string
  logger?: Logger
  /**
   * Applied only when no config file exists yet (first launch), before the first save — e.g. the UI
   * language detected from the OS. Existing configs are never touched by it.
   */
  initial?: () => ConfigPatch
  /** Session-only fields can be reset after loading and omitted from the on-disk representation. */
  transformLoaded?: (config: AppConfig) => AppConfig
  transformPersisted?: (config: AppConfig) => AppConfig
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/**
 * Recursive merge: objects merge key-by-key, arrays and primitives replace, `undefined` is skipped,
 * `null` deletes the key (lets the UI clear optional fields such as `ai.defaultModel`).
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) {
      delete out[key]
      continue
    }
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return out as T
}

/** Write via temp file + rename so a crash mid-write never leaves a truncated config. */
export function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

export function createConfigService(opts: ConfigServiceOptions): ConfigService {
  const log = (opts.logger ?? nullLogger).child('config')
  const listeners = new Set<(next: AppConfig, prev: AppConfig) => void>()
  let current: AppConfig = load()

  function load(): AppConfig {
    if (!existsSync(opts.file)) {
      const cfg = applyLoaded(firstRunConfig())
      persist(cfg)
      return cfg
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(opts.file, 'utf8'))
    } catch (e) {
      log.error('config.json could not be parsed; backed up and using defaults', e)
      backup()
      const cfg = applyLoaded(defaultConfig())
      persist(cfg)
      return cfg
    }
    const parsed = AppConfigSchema.safeParse(raw)
    if (parsed.success) {
      const cfg = applyLoaded(parsed.data)
      // Re-write once so values that became session-only are also removed from an older config.
      persist(cfg)
      return cfg
    }
    log.error('config.json failed validation; backed up and using defaults', parsed.error.issues)
    backup()
    const cfg = applyLoaded(defaultConfig())
    persist(cfg)
    return cfg
  }

  function firstRunConfig(): AppConfig {
    const base = defaultConfig()
    if (!opts.initial) return base
    const parsed = AppConfigSchema.safeParse(deepMerge<unknown>(base, opts.initial()))
    return parsed.success ? parsed.data : base
  }

  function applyLoaded(cfg: AppConfig): AppConfig {
    return opts.transformLoaded ? opts.transformLoaded(cfg) : cfg
  }

  function backup(): void {
    try {
      renameSync(opts.file, `${opts.file}.bak-${Date.now()}`)
    } catch {
      // nothing else to do
    }
  }

  function persist(cfg: AppConfig): void {
    try {
      atomicWriteJson(opts.file, opts.transformPersisted ? opts.transformPersisted(cfg) : cfg)
    } catch (e) {
      log.error('writing config.json failed', e)
      throw e
    }
  }

  function commit(next: AppConfig): AppConfig {
    const prev = current
    current = next
    persist(next)
    for (const l of listeners) {
      try {
        l(next, prev)
      } catch (e) {
        log.warn('config subscriber threw', e)
      }
    }
    return next
  }

  return {
    file: opts.file,
    get: () => current,
    set(patch) {
      const merged = deepMerge<unknown>(current, patch)
      const parsed = AppConfigSchema.safeParse(merged)
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        throw new Error(t('main.config.invalid', { detail: msg }))
      }
      return commit(parsed.data)
    },
    replace(next) {
      const parsed = AppConfigSchema.safeParse(next)
      if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        throw new Error(t('main.config.invalid', { detail: msg }))
      }
      return commit(parsed.data)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
