/**
 * App config store (zustand). Hydrated once from config:get; `set(patch)` applies the patch
 * optimistically, pushes it through config:set and reconciles with the returned config. The theme
 * is applied to <html data-theme> immediately so toggles feel instant (DESIGN-SPEC §2 常规).
 */
import { create } from 'zustand'
import type { AppConfig, ConfigPatch } from '@aiwc/protocol'
import { applyPalette } from './appearance'
import { getBridge } from './bridge'

export type ResolvedTheme = 'dark' | 'light'

export interface ConfigState {
  config: AppConfig | undefined
  hydrated: boolean
  error: Error | undefined
  /** Load from the bridge (idempotent — later calls return the same promise while in flight). */
  hydrate(): Promise<AppConfig>
  /** Optimistic patch → config:set → reconcile; rejects (and rolls back) on failure. */
  set(patch: ConfigPatch): Promise<AppConfig>
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
  return next as AppConfig
}

export function resolveTheme(theme: AppConfig['general']['theme']): ResolvedTheme {
  if (theme !== 'system') return theme
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let systemListener: (() => void) | undefined

/** Stamp the resolved theme on <html>; follows the OS when theme === 'system'. */
export function applyTheme(theme: AppConfig['general']['theme'], appearance?: AppConfig['general']['appearance']): ResolvedTheme {
  if (typeof document === 'undefined') return resolveTheme(theme)
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  applyPalette(resolved, appearance)
  systemListener?.()
  systemListener = undefined
  if (theme === 'system' && typeof matchMedia === 'function') {
    try {
      const mq = matchMedia('(prefers-color-scheme: light)')
      const onChange = () => {
        const mode = mq.matches ? 'light' : 'dark'
        document.documentElement.dataset.theme = mode
        applyPalette(mode, appearance)
      }
      mq.addEventListener('change', onChange)
      systemListener = () => mq.removeEventListener('change', onChange)
    } catch {
      /* matchMedia unavailable */
    }
  }
  return resolved
}

let hydrating: Promise<AppConfig> | undefined

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: undefined,
  hydrated: false,
  error: undefined,

  hydrate() {
    if (get().hydrated && get().config) return Promise.resolve(get().config as AppConfig)
    if (hydrating) return hydrating
    hydrating = getBridge()
      .then((b) => b.invoke('config:get', undefined))
      .then((config) => {
        applyTheme(config.general.theme, config.general.appearance)
        set({ config, hydrated: true, error: undefined })
        return config
      })
      .catch((e: unknown) => {
        set({ error: e instanceof Error ? e : new Error(String(e)) })
        throw e
      })
      .finally(() => {
        hydrating = undefined
      })
    return hydrating
  },

  async set(patch) {
    const previous = get().config
    if (previous) {
      const optimistic = mergePatch(previous, patch)
      if (patch.general) applyTheme(optimistic.general.theme, optimistic.general.appearance)
      set({ config: optimistic })
    }
    try {
      const bridge = await getBridge()
      const confirmed = await bridge.invoke('config:set', patch)
      applyTheme(confirmed.general.theme, confirmed.general.appearance)
      set({ config: confirmed, hydrated: true, error: undefined })
      return confirmed
    } catch (e) {
      if (previous) {
        applyTheme(previous.general.theme, previous.general.appearance)
        set({ config: previous })
      }
      throw e
    }
  },
}))

/** Selector helper: `const theme = useConfig((c) => c.general.theme)` (undefined until hydrated). */
export function useConfig<T>(selector: (config: AppConfig) => T): T | undefined {
  return useConfigStore((s) => (s.config ? selector(s.config) : undefined))
}

/** Reset module-level state (tests). */
export function __resetConfigStoreForTests(): void {
  hydrating = undefined
  systemListener?.()
  systemListener = undefined
  useConfigStore.setState({ config: undefined, hydrated: false, error: undefined })
}
