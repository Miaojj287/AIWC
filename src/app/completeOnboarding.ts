/**
 * Finishing the onboarding wizard from the app root. configStore shows the Shell optimistically and rolls back to
 * the wizard when the write fails, so a failure must be visible (AGENTS.md §2.4): an error toast whose retry saves
 * again, dismissed once a save goes through.
 */
import { t } from '@/i18n'
import { toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'

const SAVE_FAILED_TOAST_ID = 'app.onboardingSaveFailed'

let saving: Promise<void> | undefined

/** Persist `onboarding.completed`; a second call while one is in flight joins it. Never rejects. */
export function completeOnboarding(): Promise<void> {
  saving ??= useConfigStore
    .getState()
    .set({ onboarding: { completed: true } })
    .then(
      () => toast.dismiss(SAVE_FAILED_TOAST_ID),
      (error: unknown) => {
        toast.error(t('app.onboardingSaveFailed'), {
          id: SAVE_FAILED_TOAST_ID,
          detail: error instanceof Error ? error.message : String(error),
          action: { label: t('common.retry'), onClick: () => void completeOnboarding() },
        })
      },
    )
    .finally(() => {
      saving = undefined
    })
  return saving
}
