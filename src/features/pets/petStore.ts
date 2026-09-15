/**
 * Installed pets (zustand). Loaded on first use, refreshed whenever main reports 'pet:changed', so the
 * Agent panel and 设置 › 宠物 always show the same list.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { InstalledPet, PetConfig } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'
import { invoke } from '@/platform/hooks'
import { resolveCurrentPet } from './petModel'

export interface PetStoreState {
  pets: InstalledPet[]
  loaded: boolean
  loading: boolean
  error?: string
  load(): Promise<void>
}

let inflight: Promise<void> | undefined
let subscribed = false

export const usePetStore = create<PetStoreState>((set) => ({
  pets: [],
  loaded: false,
  loading: false,
  error: undefined,
  load() {
    inflight ??= (async () => {
      set({ loading: true })
      try {
        set({ pets: await invoke('pet:list', undefined), loaded: true, loading: false, error: undefined })
      } catch (e) {
        set({ loaded: true, loading: false, error: e instanceof Error ? e.message : String(e) })
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  },
}))

function subscribeOnce(): void {
  if (subscribed) return
  subscribed = true
  void getBridge()
    .then((b) => b.on('pet:changed', () => void usePetStore.getState().load()))
    .catch(() => {
      subscribed = false
    })
}

/** Installed pets, loading them (and listening for changes) on first mount. */
export function useInstalledPets(): PetStoreState {
  const state = usePetStore()
  useEffect(() => {
    subscribeOnce()
    if (!usePetStore.getState().loaded) void usePetStore.getState().load()
  }, [])
  return state
}

export function useCurrentPet(config: PetConfig | undefined): InstalledPet | undefined {
  const { pets } = useInstalledPets()
  return resolveCurrentPet(pets, config)
}

/** Reset module state (tests). */
export function __resetPetStoreForTests(): void {
  inflight = undefined
  subscribed = false
  usePetStore.setState({ pets: [], loaded: false, loading: false, error: undefined })
}
