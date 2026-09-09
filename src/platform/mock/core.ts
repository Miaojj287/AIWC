/**
 * Shared plumbing for the web-mode mock bridge: handler typing, event emitter, scaled timers,
 * a tiny seeded PRNG, localStorage-backed KV and the mock's AppConfig.
 */
import {
  AppConfigSchema,
  type AiwcBridge,
  type AppConfig,
  type ConfigPatch,
  type EventChannel,
  type EventMap,
  type InvokeChannel,
  type InvokeReq,
  type InvokeRes,
} from '@aiwc/protocol'
import type { DemoFixture } from './types'
import { indexFixture, type DatasetIndex } from './dataset'

export const CONFIG_KEY = 'aiwc.mock.config'

/** Every InvokeMap channel must be implemented — the compiler enforces completeness. */
export type Handlers = { [K in InvokeChannel]: (req: InvokeReq<K>) => Promise<InvokeRes<K>> | InvokeRes<K> }
/** Subset of handlers whose channel starts with `${P}:`. */
export type HandlersFor<P extends string> = { [K in InvokeChannel as K extends `${P}:${string}` ? K : never]: Handlers[K] }

export type Emit = <K extends EventChannel>(channel: K, payload: EventMap[K]) => void

export interface MockOptions {
  fixture: DemoFixture
  /** 1 = realistic timings, 0 = everything resolves on the next tick (tests). */
  timeScale?: number
  now?: () => number
  seed?: number
  storage?: Storage | null
  /** Force the onboarding flag; defaults to `?onboarding=1` detection on location.search. */
  onboarding?: boolean
}

export interface KV {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
  remove(key: string): void
}

export interface Rng {
  next(): number
  int(min: number, max: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
}

export class AbortedError extends Error {
  override readonly name = 'AbortError'
  constructor(message = 'aborted') {
    super(message)
  }
}
export const isAborted = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

export interface MockContext {
  data: DatasetIndex
  now(): number
  /** setTimeout scaled by timeScale; rejects with AbortedError when the signal fires. */
  delay(ms: number, signal?: AbortSignal): Promise<void>
  emit: Emit
  on: AiwcBridge['on']
  rng: Rng
  kv: KV
  config(): AppConfig
  setConfig(patch: ConfigPatch): AppConfig
  /** short unique id with a prefix, e.g. id('draft') → 'draft_1k' */
  id(prefix: string): string
  platform: AiwcBridge['platform']
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
  }
}

export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function createKv(storage: Storage | null): KV {
  return {
    get(key, fallback) {
      try {
        const raw = storage?.getItem(key)
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as typeof fallback)
      } catch {
        return fallback
      }
    },
    set(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value))
      } catch {
        /* storage unavailable (private mode / quota) — keep going in memory */
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key)
      } catch {
        /* ignore */
      }
    },
  }
}

export function detectPlatform(): AiwcBridge['platform'] {
  const ua = typeof navigator !== 'undefined' ? `${navigator.platform} ${navigator.userAgent}` : ''
  if (/Win/i.test(ua)) return 'win32'
  if (/Linux|X11/i.test(ua) && !/Mac/i.test(ua)) return 'linux'
  return 'darwin'
}

function mergePatch(base: AppConfig, patch: ConfigPatch): AppConfig {
  const next: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = (base as Record<string, unknown>)[key]
    next[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
        ? { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value
  }
  return AppConfigSchema.parse(next)
}

function detectOnboardingParam(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('onboarding') === '1'
  } catch {
    return false
  }
}

export function createMockContext(opts: MockOptions): MockContext {
  const timeScale = opts.timeScale ?? 1
  const now = opts.now ?? (() => Date.now())
  const storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage
  const kv = createKv(storage)
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>()
  let counter = 0

  const emit: Emit = (channel, payload) => {
    const set = listeners.get(channel)
    if (!set) return
    for (const l of [...set]) {
      try {
        l(payload)
      } catch (err) {
        console.error(`[mockBridge] listener for ${channel} threw`, err)
      }
    }
  }

  const on: AiwcBridge['on'] = (channel, listener) => {
    const set = listeners.get(channel) ?? new Set()
    set.add(listener as (payload: unknown) => void)
    listeners.set(channel, set)
    return () => {
      set.delete(listener as (payload: unknown) => void)
    }
  }

  const showOnboarding = opts.onboarding ?? detectOnboardingParam()
  let config = AppConfigSchema.parse(kv.get<unknown>(CONFIG_KEY, {}))
  config = { ...config, onboarding: { completed: !showOnboarding } }

  return {
    data: indexFixture(opts.fixture, now()),
    now,
    delay(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortedError())
        const t = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, Math.round(ms * timeScale))
        function onAbort() {
          clearTimeout(t)
          reject(new AbortedError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
    emit,
    on,
    rng: createRng(opts.seed ?? 0x5eed),
    kv,
    config: () => config,
    setConfig(patch) {
      config = mergePatch(config, patch)
      kv.set(CONFIG_KEY, config)
      return config
    },
    id(prefix) {
      counter += 1
      return `${prefix}_${counter.toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`
    },
    platform: detectPlatform(),
  }
}
