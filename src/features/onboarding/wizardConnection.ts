import { WechatCredentialStatusSchema, type KeyAcquireScope, type KeyAcquireStep } from '@aiwc/protocol'
import { t } from '@/i18n'
import { getBridge } from '@/platform/bridge'
import { invoke } from '@/platform/hooks'
import { closeKeySteps, initialKeySteps, mergeKeyStep } from '@/platform/wechatKeys'
import { applyKeySteps, EMPTY_KEYS, hasKey, needsPermission } from './gating'
import type { WizardState } from './wizardStore'

type SetWizard = (patch: Partial<WizardState> | ((state: WizardState) => Partial<WizardState>)) => void
type ConnectionActions = Pick<
  WizardState,
  'loadCredentials' | 'invalidateTarget' | 'acquire' | 'cancelAcquire' | 'connect' | 'testAndFinish' | 'enter'
>
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function applyAcquisitionSteps(state: WizardState, steps: readonly KeyAcquireStep[]) {
  const keys = applyKeySteps(state.keys, steps)
  // A failed supplement does not revoke persisted credentials; the capability check decides that.
  if (state.credentials?.database && hasKey(state.keys.db_key)) keys.db_key = state.keys.db_key
  return keys
}

/** Coordinate explicit acquisition and account-bound cached capabilities without exposing secrets. */
export function createWizardConnectionActions(get: () => WizardState, set: SetWizard): ConnectionActions {
  let targetEpoch = 0
  let acquireEpoch = 0
  let credentialEpoch = 0
  const targetMatches = (wxid: string, dbRoot: string, epoch: number) =>
    targetEpoch === epoch && get().wxid === wxid && get().dbRoot === dbRoot

  const loadCredentials = async () => {
    const { wxid, dbRoot } = get()
    if (!wxid || !dbRoot) return
    const target = targetEpoch
    const request = ++credentialEpoch
    const keys = get().keys
    set({ credentialsLoading: true, credentialsError: undefined })
    try {
      const credentials = WechatCredentialStatusSchema.parse(
        await invoke('substrate:credentialStatus', { wxid, dbRoot }),
      )
      if (request !== credentialEpoch || !targetMatches(wxid, dbRoot, target)) return
      if (keys !== get().keys) {
        set({ credentialsLoading: false })
        return
      }
      set((state) => ({
        credentials,
        credentialsLoading: false,
        keyTarget: { wxid, dbRoot },
        verifyState: credentials.database ? 'verified' : state.verifyState === 'failed' ? 'failed' : 'idle',
        keys: {
          db_key: credentials.database
            ? hasKey(state.keys.db_key)
              ? state.keys.db_key
              : { status: 'acquired', source: 'cached' }
            : state.keys.db_key.status === 'failed'
              ? state.keys.db_key
              : EMPTY_KEYS.db_key,
          image_xor: credentials.imageXor
            ? hasKey(state.keys.image_xor)
              ? state.keys.image_xor
              : { status: 'acquired', source: 'cached' }
            : state.keys.image_xor.status === 'failed'
              ? state.keys.image_xor
              : EMPTY_KEYS.image_xor,
          image_aes: credentials.imageAes
            ? hasKey(state.keys.image_aes)
              ? state.keys.image_aes
              : { status: 'acquired', source: 'cached' }
            : state.keys.image_aes.status === 'failed'
              ? state.keys.image_aes
              : EMPTY_KEYS.image_aes,
        },
      }))
    } catch {
      if (request !== credentialEpoch || !targetMatches(wxid, dbRoot, target)) return
      // Availability failure is recoverable through the explicit connection action.
      set({ credentialsLoading: false, credentialsError: t('onboarding.connect.statusFailed') })
    }
  }

  const cancelAcquire = () => {
    acquireEpoch++
    void invoke('substrate:cancelAcquireKeys', undefined).catch(() => {
      // The local run is invalidated; the utility process also bounds its own operation.
    })
    set((state) => ({
      acquiring: false,
      acquireFailed: false,
      acquireSteps: closeKeySteps(state.acquireSteps, 'cancelled', undefined, state.acquireScope),
    }))
  }

  const invalidateTarget = () => {
    targetEpoch++
    credentialEpoch++
    acquireEpoch++
    if (get().acquiring) cancelAcquire()
    set({
      keys: EMPTY_KEYS,
      keyTarget: undefined,
      credentials: undefined,
      credentialsLoading: false,
      credentialsError: undefined,
      acquiring: false,
      acquireFailed: false,
      testing: false,
      verifyState: 'idle',
      verifyError: undefined,
      testError: undefined,
    })
  }

  const acquire = async (strategy: 'auto' | 'memory_scan', scope: KeyAcquireScope = 'database') => {
    const { wxid, dbRoot } = get()
    if (!wxid || !dbRoot || get().acquiring) return
    const epoch = ++acquireEpoch
    const target = targetEpoch
    const current = () => epoch === acquireEpoch && targetMatches(wxid, dbRoot, target)
    set({
      acquiring: true,
      acquireStrategy: strategy,
      acquireScope: scope,
      acquireSteps: initialKeySteps(scope),
      acquireStartedAt: Date.now(),
      acquireFailed: false,
      permissionDialog: false,
      credentialsError: undefined,
    })
    let off: (() => void) | undefined
    try {
      const bridge = await getBridge()
      if (!current()) return
      off = bridge.on('substrate:keyStep', (step) => {
        if (current()) set((state) => ({ acquireSteps: mergeKeyStep(state.acquireSteps, step) }))
      })
      const result = await invoke('substrate:acquireKeys', { wxid, dbRoot, strategy, scope })
      if (!current()) return
      const steps = result.length ? result : closeKeySteps(get().acquireSteps, 'unexpected', undefined, scope)
      const verified = steps.some((step) => step.id === 'verify' && step.status === 'done')
      set((state) => ({
        acquiring: false,
        acquireSteps: steps,
        acquireFailed: steps.some(
          (step) => step.status === 'failed' && step.failure !== 'cancelled' && step.failure !== 'skipped',
        ),
        keys: applyAcquisitionSteps(state, steps),
        keyTarget: verified ? { wxid, dbRoot } : state.keyTarget,
        permissionDialog: needsPermission(steps),
        verifyState: verified ? 'verified' : state.verifyState,
      }))
      if (get().credentials?.database || steps.some((step) => step.status === 'done')) await loadCredentials()
    } catch (error) {
      if (!current()) return
      const steps = closeKeySteps(get().acquireSteps, 'unexpected', errorText(error), scope)
      set((state) => ({
        acquiring: false,
        acquireSteps: steps,
        acquireFailed: true,
        keys: applyAcquisitionSteps(state, steps),
        permissionDialog: needsPermission(steps),
      }))
      if (get().credentials?.database) await loadCredentials()
    } finally {
      off?.()
    }
  }

  const testAndFinish = async () => {
    const { wxid, dbRoot, cacheDir } = get()
    if (!wxid || !dbRoot || get().testing) return false
    const target = targetEpoch
    set({ testing: true, testError: undefined })
    try {
      const tested = await invoke('substrate:testConnection', { wxid, dbRoot })
      if (!targetMatches(wxid, dbRoot, target)) return false
      if (!tested.ok) {
        set({ testing: false, testError: tested.error ?? t('onboarding.connectFail.openFailed') })
        return false
      }
      const connected = await invoke('substrate:connect', { wxid, dbRoot, cacheDir: cacheDir || undefined })
      if (!targetMatches(wxid, dbRoot, target)) return false
      set({
        testing: false,
        ...(connected.ok ? {} : { testError: connected.error ?? t('onboarding.connectFail.connectFailed') }),
      })
      return connected.ok
    } catch (error) {
      if (targetMatches(wxid, dbRoot, target)) set({ testing: false, testError: errorText(error) })
      return false
    }
  }

  const connect = async (forceAcquire = false) => {
    const { wxid, dbRoot } = get()
    if (get().acquiring || get().testing || !wxid || !dbRoot) return false
    const target = targetEpoch
    if (forceAcquire || !hasKey(get().keys.db_key)) {
      const request = acquireEpoch + 1
      await acquire('auto', 'database')
      if (acquireEpoch !== request) return false
    }
    if (!targetMatches(wxid, dbRoot, target) || !hasKey(get().keys.db_key)) return false
    return testAndFinish()
  }

  return { loadCredentials, invalidateTarget, acquire, cancelAcquire, connect, testAndFinish, enter: testAndFinish }
}
