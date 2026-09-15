/**
 * Small bridge helpers shared by the settings pages: config writes with a toast on failure, a
 * config re-fetch after main-side mutations (key acquisition), and secret presence tracking.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ConfigPatch } from '@aiwc/protocol'
import { useTabsStore } from '@/workspace/tabsStore'
import { toast } from '@/kit'
import { t } from '@/i18n'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Optimistic config write; surfaces failures as a toast so instant-apply controls never fail silently. */
export async function saveConfig(patch: ConfigPatch): Promise<boolean> {
  try {
    await useConfigStore.getState().set(patch)
    return true
  } catch (e) {
    toast.error(t('settings.nav.config.saveFailed'), { detail: errorMessage(e) })
    return false
  }
}

/** Re-read the config after the main process changed it behind our back (acquireKeys, setManualKey…). */
export async function refreshConfig(): Promise<void> {
  try {
    const config = await invoke('config:get', undefined)
    useConfigStore.setState({ config, hydrated: true, error: undefined })
  } catch (e) {
    toast.error(t('settings.nav.config.loadFailed'), { detail: errorMessage(e) })
  }
}

export interface SecretPresence {
  has: boolean | undefined
  reload: () => void
}

/** Whether a secret exists for `ref` (masked display); `version` bumps force a re-check. */
export function useSecretPresence(ref: string, version = 0): SecretPresence {
  const [has, setHas] = useState<boolean | undefined>(undefined)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    invoke('secret:has', { ref })
      .then((v) => {
        if (!cancelled) setHas(v)
      })
      .catch(() => {
        if (!cancelled) setHas(false)
      })
    return () => {
      cancelled = true
    }
  }, [ref, version, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { has, reload }
}

/** Copy text to the clipboard with a toast either way. */
export async function copyText(text: string, what?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('common.copied', { what: what ?? t('common.content') }))
  } catch (e) {
    toast.error(t('common.copyFailed'), { detail: errorMessage(e) })
  }
}

/** Commit account selection only after the database has reopened; never report a config-only switch. */
export async function activateAccount(account: NonNullable<ConfigPatch['account']>): Promise<boolean> {
  try {
    const previous = await invoke('substrate:status', undefined)
    if (!account.wxid || !account.dbRoot) throw new Error(t('settings.account.switchAccount.selectFirst'))
    const result = await invoke('substrate:connect', { wxid: account.wxid, dbRoot: account.dbRoot })
    if (!result.ok) throw new Error(result.error ?? t('settings.account.switchAccount.connectFailed'))
    const connected = await invoke('substrate:status', undefined)
    if (connected.connection !== 'ready' || connected.account?.wxid !== account.wxid) {
      throw new Error(t('settings.account.switchAccount.mismatch'))
    }
    if (previous.account?.wxid !== account.wxid || previous.account?.dbRoot !== account.dbRoot) {
      const store = useTabsStore.getState()
      for (const tab of store.tabs) if (tab.kind === 'chat') store.close(tab.id)
      useTabsStore.setState((s) => ({ recentlyClosed: s.recentlyClosed.filter((t) => t.kind !== 'chat') }))
    }
    await refreshConfig()
    return true
  } catch (e) {
    await refreshConfig()
    toast.error(t('settings.account.switchAccount.failed'), { detail: errorMessage(e) })
    return false
  }
}
