/**
 * Pure helpers of agentStore.ts, kept apart so the store stays under the file ceiling (AGENTS.md §2.3):
 * thread ordering, error text, and the settings a new desktop thread starts with.
 */
import type { ThreadSettings, ThreadSummary } from '@aiwc/protocol'
import { useConfigStore } from '@/platform/configStore'

/** Pinned first, then most recently updated. */
export const sortThreads = (list: ThreadSummary[]): ThreadSummary[] =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Settings of a thread created in the panel / Agent window: the configured defaults, desktop-chat profile. */
export async function threadSettingsFromConfig(): Promise<ThreadSettings> {
  const store = useConfigStore.getState()
  const config = store.config ?? (await store.hydrate().catch(() => undefined))
  return {
    permissionMode: config?.agent.permissionMode ?? 'ask',
    allowAlways: [...(config?.agent.allowAlways ?? [])],
    profile: 'desktop-chat',
    model: config?.ai.defaultModel,
  }
}
