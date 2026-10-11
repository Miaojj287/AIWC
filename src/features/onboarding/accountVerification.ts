import { t } from '@/i18n'
import { invoke } from '@/platform/hooks'
import type { WizardState } from './wizardStore'
import { EMPTY_KEYS, hasKey } from './gating'

type VerificationPatch = Partial<Pick<WizardState, 'verifyState' | 'verifyError' | 'accounts' | 'keys' | 'keyTarget'>>
let verificationEpoch = 0

/** Verify the selected account's stored key without applying results after the selection or key changes. */
export async function verifyWizardAccount(
  get: () => WizardState,
  set: (patch: VerificationPatch | ((state: WizardState) => VerificationPatch)) => void,
): Promise<boolean> {
  const { wxid, dbRoot, keys, keyTarget } = get()
  if (!wxid || !dbRoot) return false
  const epoch = ++verificationEpoch
  const isCurrent = () => {
    const current = get()
    return (
      epoch === verificationEpoch &&
      current.wxid === wxid &&
      current.dbRoot === dbRoot &&
      current.keys === keys &&
      current.verifyState === 'verifying'
    )
  }
  const fail = (error: string, hasWrongTarget = false) => {
    set((state) => ({
      verifyState: 'failed',
      verifyError: error,
      keys: { ...(hasWrongTarget ? EMPTY_KEYS : state.keys), db_key: { status: 'failed', error } },
      accounts: state.accounts.map((account) => (account.wxid === wxid ? { ...account, verified: false } : account)),
    }))
    return false
  }
  if (keyTarget && (keyTarget.wxid !== wxid || keyTarget.dbRoot !== dbRoot)) {
    return fail(t('onboarding.account.keyMismatch'), true)
  }
  set({ verifyState: 'verifying', verifyError: undefined })
  try {
    const result = await invoke('substrate:verifyAccount', { wxid, dbRoot })
    if (!isCurrent()) return false
    if (!result.ok) return fail(result.error ?? t('onboarding.account.verifyMismatch'))
    set((state) => ({
      verifyState: 'verified',
      keyTarget: { wxid, dbRoot },
      keys: hasKey(state.keys.db_key)
        ? state.keys
        : { ...state.keys, db_key: { status: 'acquired', source: 'cached' } },
      accounts: state.accounts.map((account) => (account.wxid === wxid ? { ...account, verified: true } : account)),
    }))
    return true
  } catch (error) {
    if (!isCurrent()) return false
    return fail(error instanceof Error ? error.message : String(error))
  }
}
