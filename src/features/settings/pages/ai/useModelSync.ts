import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '@aiwc/protocol'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { resolveDefaultModel, syncProviderModels, upsertProvider } from '../../aiModel'
import { errorMessage } from '../../hooks'

const TTL = 10 * 60_000
/** Sync the visible provider on entry/focus, with a TTL and stale-response protection. */
export function useModelSync(provider: ProviderConfig | undefined) {
  const [state, setState] = useState<{ id?: string; loading: boolean; error?: string }>({ loading: false })
  const busy = useRef(new Set<string>())
  const attempts = useRef(new Map<string, number>())
  const sync = useCallback(async (p: ProviderConfig, force = false) => {
    if (busy.current.has(p.id) || (!p.apiKeyRef && p.kind !== 'ollama')) return
    if (!force && Date.now() - Math.max(p.modelsSyncedAt ?? 0, attempts.current.get(p.id) ?? 0) < TTL) return
    busy.current.add(p.id)
    attempts.current.set(p.id, Date.now())
    setState({ id: p.id, loading: true })
    try {
      const remote = await invoke('ai:discoverModels', { provider: p })
      const ai = useConfigStore.getState().config?.ai
      const current = ai?.providers.find(x => x.id === p.id)
      if (!ai || !current || current.baseUrl !== p.baseUrl || current.kind !== p.kind || current.apiKeyRef !== p.apiKeyRef || current.modelsSyncedAt !== p.modelsSyncedAt) return
      const providers = upsertProvider(ai.providers, syncProviderModels(current, remote))
      await useConfigStore.getState().set({ ai: { providers, defaultModel: resolveDefaultModel(providers, ai.defaultModel) } })
      setState({ id: p.id, loading: false })
    } catch (e) {
      setState({ id: p.id, loading: false, error: errorMessage(e) })
    } finally {
      busy.current.delete(p.id)
      setState(s => s.id === p.id ? { ...s, loading: false } : s)
    }
  }, [])
  useEffect(() => {
    if (!provider) return
    void sync(provider)
    const refresh = () => { void sync(provider) }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, TTL)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [provider, sync])
  return { syncing: state.id === provider?.id && state.loading, syncError: state.id === provider?.id ? state.error : undefined, onSync: () => { if (provider) void sync(provider, true) } }
}
