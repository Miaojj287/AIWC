/**
 * Which group chats 每日待办 scans (config `todo.sources`). Every add goes through here — the object
 * list's toggles and menus, the dashboard's 加入扫描 — so the cap and the toast are the same everywhere.
 */
import { TODO_MAX_SOURCES, type TodoSource } from '@aiwc/protocol'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const canAddSource = (sources: readonly TodoSource[]): boolean => sources.length < TODO_MAX_SOURCES

/** Add or remove one chat from the scan; resolves false (with a toast) when the write fails or the cap is hit. */
export async function setSourcePicked(chat: TodoSource, picked: boolean): Promise<boolean> {
  const current = useConfigStore.getState().config?.todo.sources ?? []
  const has = current.some((s) => s.id === chat.id)
  if (picked === has) return true
  if (picked && !canAddSource(current)) {
    toast.warning(t('todo.sources.limit', { max: TODO_MAX_SOURCES }))
    return false
  }
  const sources = picked ? [...current, { id: chat.id, title: chat.title }] : current.filter((s) => s.id !== chat.id)
  try {
    await useConfigStore.getState().set({ todo: { sources } })
    return true
  } catch (e) {
    toast.error(t('todo.sources.saveFailed'), { detail: errorText(e) })
    return false
  }
}
