/** Pet actions shared by the Agent panel and its collapsed strip. */
import { runCommand } from '@/app/commands'
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'

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
