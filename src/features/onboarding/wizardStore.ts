/**
 * Onboarding wizard state (zustand). Everything the user typed survives leaving the wizard because it is
 * mirrored into AppConfig.account through configStore (DESIGN-SPEC §5 退出向导需确认，已填内容本地保留).
 * Bridge calls live here so the components stay declarative.
 */
import { create } from 'zustand'
import type { AppConfig, KeyAcquireStep, WxAccount } from '@aiwc/protocol'
import { t } from '@/i18n'
import { getBridge } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { closeKeySteps, initialKeySteps } from '@/platform/wechatKeys'
import {
  DEFAULT_KEY_STEPS,
  EMPTY_KEYS,
  KEY_KINDS,
  applyKeySteps,
  hasKey,
  mergeKeyStep,
  needsPermission,
  validateKeyHex,
  type KeyKind,
  type KeyStates,
  type WizardPage,
} from './gating'

export type DbRootSource = 'none' | 'cached' | 'auto' | 'manual'
export type VerifyState = 'idle' | 'verifying' | 'verified' | 'failed'

export interface WizardState {
  hydrated: boolean
  page: WizardPage
  agreed: boolean

  dbRoot: string
  dbRootSource: DbRootSource
  dbRootError?: string
  detecting: boolean
  detectedVersion?: string

  cacheDir: string
  defaultCacheDir: string

  accounts: WxAccount[]
  accountsLoading: boolean
  accountsError?: string
  wxid: string
  verifyState: VerifyState
  verifyError?: string

  keys: KeyStates
  acquiring: boolean
  acquireSteps: KeyAcquireStep[]
  acquireStrategy: 'auto' | 'memory_scan'
  /** Epoch ms the current / last run started (0 = none) — drives the elapsed time. */
  acquireStartedAt: number
  /** The last run failed: its step list and reason stay visible until dismissed or re-run. */
  acquireFailed: boolean
  permissionDialog: boolean

  testing: boolean
  testError?: string

  hydrate(config: AppConfig): Promise<void>
  setPage(page: WizardPage): void
  setAgreed(agreed: boolean): void
  detect(): Promise<void>
  browse(): Promise<void>
  setDbRoot(path: string): void
  setCacheDir(path: string): void
  browseCache(): Promise<void>
  resetCacheDir(): void
  loadAccounts(): Promise<void>
  selectWxid(wxid: string): void
  verify(): Promise<boolean>
  acquire(strategy: 'auto' | 'memory_scan'): Promise<void>
  cancelAcquire(): void
  dismissAcquireResult(): void
  dismissPermissionDialog(): void
  setManualKey(kind: KeyKind, input: string): Promise<{ ok: boolean; error?: string }>
  /** Delete the saved key from the selected account's secret store; rejects (key kept) when that fails. */
  clearKey(kind: KeyKind): Promise<void>
  /** Test the connection; on success persist account + onboarding.completed. */
  testAndFinish(): Promise<boolean>
  /**
   * 进入 on a later launch: the substrate already opened the saved account at startup, so when nothing changed on
   * the page this only confirms it is ready; any change (account, path, a new key) runs the full connection test.
   */
  enter(): Promise<boolean>
  clearTestError(): void
  /** Mirror what the user entered into AppConfig.account (called on exit). */
  persistDraft(): Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const KEY_REFS: Record<KeyKind, keyof AppConfig['account']> = {
  db_key: 'dbKeyRef',
  image_xor: 'imageXorKeyRef',
  image_aes: 'imageAesKeyRef',
}

let acquireEpoch = 0

export const useWizardStore = create<WizardState>((set, get) => ({
  hydrated: false,
  page: 'welcome',
  agreed: false,
  dbRoot: '',
  dbRootSource: 'none',
  detecting: false,
  cacheDir: '',
  defaultCacheDir: '',
  accounts: [],
  accountsLoading: false,
  wxid: '',
  verifyState: 'idle',
  keys: EMPTY_KEYS,
  acquiring: false,
  acquireSteps: [...DEFAULT_KEY_STEPS],
  acquireStrategy: 'auto',
  acquireStartedAt: 0,
  acquireFailed: false,
  permissionDialog: false,
  testing: false,

  async hydrate(config) {
    const acc = config.account
    const keys: KeyStates = { ...EMPTY_KEYS }
    await Promise.all(
      (Object.keys(KEY_REFS) as KeyKind[]).map(async (kind) => {
        const ref =
          acc[KEY_REFS[kind]] ||
          ({ db_key: 'account:dbKey', image_xor: 'account:imageXorKey', image_aes: 'account:imageAesKey' } as const)[
            kind
          ]
        if (typeof ref !== 'string' || !ref) return
        try {
          if (await invoke('secret:has', { ref })) keys[kind] = { status: 'acquired', source: 'cached' }
        } catch {
          /* secret store unavailable → treat as missing */
        }
      }),
    )
    let defaultCacheDir = ''
    try {
      const info = await invoke('app:getInfo', undefined)
      defaultCacheDir = info.dataDir ? `${info.dataDir.replace(/[\\/]$/, '')}/cache` : ''
    } catch {
      /* keep empty */
    }
    set({
      hydrated: true,
      dbRoot: acc.dbRoot ?? '',
      dbRootSource: acc.dbRoot ? 'cached' : 'none',
      cacheDir: acc.cacheDir ?? '',
      defaultCacheDir,
      wxid: acc.wxid ?? '',
      verifyState: acc.wxid && acc.verifiedAt ? 'verified' : 'idle',
      keys,
      page: config.onboarding.completed ? 'connect' : 'welcome',
    })
    if (acc.dbRoot) await get().loadAccounts()
    else await get().detect()
  },

  setPage(page) {
    set({ page })
  },
  setAgreed(agreed) {
    set({ agreed })
  },

  async detect() {
    set({ detecting: true, dbRootError: undefined })
    try {
      const res = await invoke('substrate:detectWeChat', undefined)
      if (!res.dbRoot) {
        set({
          detecting: false,
          dbRootError: res.running ? t('onboarding.account.notFoundRunning') : t('onboarding.account.notDetected'),
        })
        return
      }
      set({
        detecting: false,
        dbRoot: res.dbRoot,
        dbRootSource: 'auto',
        detectedVersion: res.version,
        verifyState: 'idle',
        verifyError: undefined,
      })
      await get().loadAccounts()
    } catch (e) {
      set({ detecting: false, dbRootError: t('onboarding.account.detectFailed', { detail: errText(e) }) })
    }
  },

  async browse() {
    try {
      const dir = await invoke('app:pickDirectory', {
        title: t('onboarding.account.pickDataFolder'),
        defaultPath: get().dbRoot || undefined,
      })
      if (!dir) return
      set({ dbRoot: dir, dbRootSource: 'manual', dbRootError: undefined, verifyState: 'idle', verifyError: undefined })
      await get().loadAccounts()
    } catch (e) {
      set({ dbRootError: errText(e) })
    }
  },

  setDbRoot(path) {
    set({
      dbRoot: path,
      dbRootSource: path ? 'manual' : 'none',
      dbRootError: undefined,
      verifyState: 'idle',
      verifyError: undefined,
    })
  },

  setCacheDir(path) {
    set({ cacheDir: path })
  },
  async browseCache() {
    const dir = await invoke('app:pickDirectory', {
      title: t('onboarding.account.pickCacheFolder'),
      defaultPath: get().cacheDir || undefined,
    }).catch(() => null)
    if (dir) set({ cacheDir: dir })
  },
  resetCacheDir() {
    set({ cacheDir: '' })
  },

  async loadAccounts() {
    const { dbRoot } = get()
    if (!dbRoot.trim()) {
      set({ accounts: [], accountsError: undefined })
      return
    }
    set({ accountsLoading: true, accountsError: undefined })
    try {
      const accounts = await invoke('substrate:listAccounts', { dbRoot })
      if (get().dbRoot !== dbRoot) return
      const current = get().wxid
      const stillThere = accounts.find((a) => a.wxid === current)
      const pick = stillThere ?? (accounts.length === 1 ? accounts[0] : undefined)
      set({
        accounts,
        accountsLoading: false,
        wxid: pick?.wxid ?? (accounts.some((a) => a.wxid === current) ? current : ''),
        verifyState: pick?.verified
          ? 'verified'
          : pick && get().verifyState === 'verified' && pick.wxid === current
            ? 'verified'
            : 'idle',
        accountsError: accounts.length === 0 ? t('onboarding.account.noAccounts') : undefined,
      })
    } catch (e) {
      set({
        accountsLoading: false,
        accounts: [],
        accountsError: t('onboarding.account.loadAccountsFailed', { detail: errText(e) }),
      })
    }
  },

  selectWxid(wxid) {
    const acc = get().accounts.find((a) => a.wxid === wxid)
    set({ wxid, verifyState: acc?.verified ? 'verified' : 'idle', verifyError: undefined })
  },

  async verify() {
    const { wxid, dbRoot } = get()
    if (!wxid || !dbRoot) return false
    set({ verifyState: 'verifying', verifyError: undefined })
    try {
      const res = await invoke('substrate:verifyAccount', { wxid, dbRoot })
      if (res.ok) {
        set((s) => ({
          verifyState: 'verified',
          accounts: s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: true } : a)),
        }))
        return true
      }
      set({ verifyState: 'failed', verifyError: res.error ?? t('onboarding.account.verifyMismatch') })
      return false
    } catch (e) {
      set({ verifyState: 'failed', verifyError: errText(e) })
      return false
    }
  },

  async acquire(strategy) {
    const { wxid, dbRoot } = get()
    if (!wxid || !dbRoot) return
    const my = ++acquireEpoch
    set({
      acquiring: true,
      acquireStrategy: strategy,
      acquireSteps: initialKeySteps(),
      acquireStartedAt: Date.now(),
      acquireFailed: false,
      permissionDialog: false,
    })
    const bridge = await getBridge()
    const off = bridge.on('substrate:keyStep', (step) => {
      if (my !== acquireEpoch) return
      set((s) => ({ acquireSteps: mergeKeyStep(s.acquireSteps, step) }))
    })
    try {
      const steps = await invoke('substrate:acquireKeys', { wxid, dbRoot, strategy })
      if (my !== acquireEpoch) return
      const finalSteps = steps.length ? steps : closeKeySteps(get().acquireSteps, 'unexpected')
      const keys = applyKeySteps(get().keys, finalSteps)
      const verifyStep = finalSteps.find((s) => s.id === 'verify')
      set((s) => ({
        acquiring: false,
        acquireSteps: finalSteps,
        acquireFailed: finalSteps.some((st) => st.status === 'failed' && st.failure !== 'cancelled'),
        keys,
        permissionDialog: needsPermission(finalSteps),
        verifyState: verifyStep?.status === 'done' ? 'verified' : s.verifyState,
        accounts:
          verifyStep?.status === 'done'
            ? s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: true } : a))
            : s.accounts,
      }))
    } catch (e) {
      if (my !== acquireEpoch) return
      // The IPC itself failed: close every open step on the error so nothing keeps spinning.
      const msg = errText(e)
      const closed = closeKeySteps(get().acquireSteps, 'unexpected', msg)
      set((s) => ({
        acquiring: false,
        acquireSteps: closed,
        acquireFailed: true,
        keys: applyKeySteps(s.keys, closed),
        permissionDialog: needsPermission(closed),
      }))
    } finally {
      off()
    }
  },

  cancelAcquire() {
    acquireEpoch++
    // Stop the main-process run too (it kills its helpers and brings WeChat back if it closed it).
    void invoke('substrate:cancelAcquireKeys', undefined).catch(() => undefined)
    set((s) => ({
      acquiring: false,
      acquireFailed: false,
      acquireSteps: closeKeySteps(s.acquireSteps, 'cancelled'),
    }))
  },

  dismissAcquireResult() {
    set({ acquireFailed: false })
  },

  dismissPermissionDialog() {
    set({ permissionDialog: false })
  },

  async setManualKey(kind, input) {
    const v = validateKeyHex(kind, input)
    if (!v.ok) return { ok: false, error: v.error }
    try {
      const res = await invoke('substrate:setManualKey', {
        kind,
        hex: v.hex,
        target: { wxid: get().wxid, dbRoot: get().dbRoot },
      })
      if (!res.ok) return { ok: false, error: res.error ?? t('onboarding.keys.invalidKey') }
      set((s) => ({
        keys: { ...s.keys, [kind]: { status: 'manual', hex: v.hex } },
        testError: undefined,
        ...(kind === 'db_key'
          ? {
              verifyState: 'idle' as const,
              verifyError: undefined,
              accounts: s.accounts.map((a) => ({ ...a, verified: false })),
            }
          : {}),
      }))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errText(e) }
    }
  },

  async clearKey(kind) {
    const { wxid, dbRoot } = get()
    await invoke('substrate:clearKey', { kind, ...(wxid && dbRoot ? { target: { wxid, dbRoot } } : {}) })
    set((s) => ({
      keys: { ...s.keys, [kind]: { status: 'missing' } },
      ...(kind === 'db_key'
        ? {
            verifyState: 'idle' as const,
            verifyError: undefined,
            accounts: s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: false } : a)),
          }
        : {}),
    }))
  },

  async testAndFinish() {
    const { wxid, dbRoot, cacheDir } = get()
    set({ testing: true, testError: undefined })
    try {
      const res = await invoke('substrate:testConnection', { wxid, dbRoot })
      if (!res.ok) {
        set({ testing: false, testError: res.error ?? t('onboarding.connectFail.openFailed') })
        return false
      }
      const connected = await invoke('substrate:connect', { wxid, dbRoot, cacheDir: cacheDir || undefined })
      if (!connected.ok) {
        set({ testing: false, testError: connected.error ?? t('onboarding.connectFail.connectFailed') })
        return false
      }
      // onboarding.completed is written by the app root once the wizard is done (after 接入模型).
      set({ testing: false })
      return true
    } catch (e) {
      set({ testing: false, testError: errText(e) })
      return false
    }
  },

  async enter() {
    const { wxid, dbRoot, keys } = get()
    const keysChanged = KEY_KINDS.some((kind) => {
      const k = keys[kind]
      return k.status === 'manual' || (k.status === 'acquired' && k.source === 'auto')
    })
    if (!keysChanged) {
      try {
        const status = await invoke('substrate:status', undefined)
        if (status.connection === 'ready' && status.account?.wxid === wxid && status.account.dbRoot === dbRoot) {
          const result = await invoke('substrate:connect', { wxid, dbRoot })
          return result.ok
        }
      } catch {
        // Status unavailable: the full test below reports the real problem.
      }
    }
    return get().testAndFinish()
  },

  clearTestError() {
    set({ testError: undefined })
  },

  async persistDraft() {
    const { cacheDir } = get()
    try {
      await useConfigStore.getState().set({ account: { cacheDir: cacheDir || undefined } })
    } catch {
      /* best effort */
    }
  },
}))

/** Derived: the db key is present from any source. */
export const selectDbKeyPresent = (s: WizardState): boolean => hasKey(s.keys.db_key)

/** Reset for tests. */
export function __resetWizardStoreForTests(): void {
  acquireEpoch++
  useWizardStore.setState({
    hydrated: false,
    page: 'welcome',
    agreed: false,
    dbRoot: '',
    dbRootSource: 'none',
    dbRootError: undefined,
    detecting: false,
    detectedVersion: undefined,
    cacheDir: '',
    defaultCacheDir: '',
    accounts: [],
    accountsLoading: false,
    accountsError: undefined,
    wxid: '',
    verifyState: 'idle',
    verifyError: undefined,
    keys: EMPTY_KEYS,
    acquiring: false,
    acquireSteps: [...DEFAULT_KEY_STEPS],
    acquireStrategy: 'auto',
    acquireStartedAt: 0,
    acquireFailed: false,
    permissionDialog: false,
    testing: false,
    testError: undefined,
  })
}
