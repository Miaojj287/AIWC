/** Pet actions shared by the Agent panel and its collapsed strip. */
import { runCommand } from '@/app/commands'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'
import { useShellStore } from '@/shell/shellStore'
import type { PetStatusItem } from './petStatus'

export function openPetSettings(): void {
  runCommand('tab.openSettings', { page: 'pets' })
}

/** 隐藏宠物 from the pet's own menu; the toast says where to turn it back on. */
export async function hidePet(): Promise<void> {
  try {
    await useConfigStore.getState().set({ pet: { enabled: false } })
    toast.info(t('pets.pet.hidden'), { detail: t('pets.pet.hiddenDetail') })
  } catch (e) {
    toast.error(t('pets.pet.hideFailed'), { detail: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * A status readout was clicked: a thread count opens that thread (the Agent window keeps it in place, the
 * workbench expands the panel); unread messages open 聊天 with the list narrowed to unread chats.
 */
export function openPetStatus(item: Pick<PetStatusItem, 'kind' | 'threadId'>): void {
  if (item.kind === 'unread') {
    runCommand('rail.select', { fn: 'chat' })
    useShellStore.getState().setListFilter('unreadOnly', true)
    return
  }
  if (item.threadId) runCommand('agent.openThread', { threadId: item.threadId })
}
