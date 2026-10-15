/**
 * Onboarding wizard state (zustand). Everything the user typed survives leaving the wizard because it is
 * mirrored into AppConfig.account through configStore (DESIGN-SPEC §5 退出向导需确认，已填内容本地保留).
 * Bridge calls live here so the components stay declarative.
 */
import { create } from 'zustand'
import type { AppConfig, KeyAcquireScope, KeyAcquireStep, WechatCredentialStatus, WxAccount } from '@aiwc/protocol'
import { t } from '@/i18n'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { verifyWizardAccount } from './accountVerification'
import { createWizardConnectionActions } from './wizardConnection'
import { DEFAULT_KEY_STEPS, EMPTY_KEYS, validateKeyHex, type KeyKind, type KeyStates, type WizardPage } from './gating'

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
  keyTarget?: Pick<WxAccount, 'wxid' | 'dbRoot'>
  acquiring: boolean
  acquireSteps: KeyAcquireStep[]
  acquireStrategy: 'auto' | 'memory_scan'
  acquireScope: KeyAcquireScope
  credentials?: WechatCredentialStatus
  credentialsLoading: boolean
  credentialsError?: string
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
  acquire(strategy: 'auto' | 'memory_scan', scope?: KeyAcquireScope): Promise<void>
  loadCredentials(): Promise<void>
  invalidateTarget(): void
  /** Acquire database access if needed, then connect in one explicit action. */
  connect(forceAcquire?: boolean): Promise<boolean>
  cancelAcquire(): void
  dismissAcquireResult(): void
  dismissPermissionDialog(): void
  setManualKey(kind: KeyKind, input: string): Promise<{ ok: boolean; error?: string }>
  /** Delete the saved key from the selected account's secret store; rejects (key kept) when that fails. */
  clearKey(kind: KeyKind): Promise<void>
  /** Test the connection; on success persist account + onboarding.completed. */
  testAndFinish(): Promise<boolean>
  /** Retry a cached account connection without acquiring credentials. */
  enter(): Promise<boolean>
  clearTestError(): void
  /** Mirror what the user entered into AppConfig.account (called on exit). */
  persistDraft(): Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
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
  acquireScope: 'database',
  credentialsLoading: false,
  acquireStartedAt: 0,
  acquireFailed: false,
  permissionDialog: false,
  testing: false,

  async hydrate(config) {
    const acc = config.account
    get().invalidateTarget()
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
      verifyState: 'idle',
      keys: EMPTY_KEYS,
      keyTarget: acc.wxid && acc.dbRoot ? { wxid: acc.wxid, dbRoot: acc.dbRoot } : undefined,
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
    get().invalidateTarget()
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
      get().invalidateTarget()
      set({ dbRoot: dir, dbRootSource: 'manual', dbRootError: undefined, verifyState: 'idle', verifyError: undefined })
      await get().loadAccounts()
    } catch (e) {
      set({ dbRootError: errText(e) })
    }
  },

  setDbRoot(path) {
    if (path !== get().dbRoot) get().invalidateTarget()
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
      const pick = stillThere ?? (!current && accounts.length === 1 ? accounts[0] : undefined)
      const wxid = pick?.wxid ?? current
      if (wxid !== current) get().invalidateTarget()
      set({
        accounts,
        accountsLoading: false,
        wxid,
        accountsError: accounts.length === 0 ? t('onboarding.account.noAccounts') : undefined,
      })
      await get().loadCredentials()
    } catch (e) {
      if (get().dbRoot !== dbRoot) return
      set({
        accountsLoading: false,
        accounts: [],
        accountsError: t('onboarding.account.loadAccountsFailed', { detail: errText(e) }),
      })
      await get().loadCredentials()
    }
  },

  selectWxid(wxid) {
    if (wxid === get().wxid) return
    get().invalidateTarget()
    set({ wxid })
    void get().loadCredentials()
  },

  async verify() {
    return verifyWizardAccount(get, set)
  },

  ...createWizardConnectionActions(get, set),

  dismissAcquireResult() {
    set({ acquireFailed: false })
  },

  dismissPermissionDialog() {
    set({ permissionDialog: false })
  },

  async setManualKey(kind, input) {
    const v = validateKeyHex(kind, input)
    if (!v.ok) return { ok: false, error: v.error }
    const target = { wxid: get().wxid, dbRoot: get().dbRoot }
    try {
      const res = await invoke('substrate:setManualKey', {
        kind,
        hex: v.hex,
        target,
      })
      if (!res.ok) return { ok: false, error: res.error ?? t('onboarding.keys.invalidKey') }
      if (get().wxid !== target.wxid || get().dbRoot !== target.dbRoot) return { ok: true }
      set((s) => ({
        keys: { ...s.keys, [kind]: { status: 'manual', hex: v.hex } },
        keyTarget: kind === 'db_key' ? { wxid: s.wxid, dbRoot: s.dbRoot } : s.keyTarget,
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
    if (get().wxid !== wxid || get().dbRoot !== dbRoot) return
    set((s) => ({
      keys: { ...s.keys, [kind]: { status: 'missing' } },
      credentials: s.credentials
        ? {
            ...s.credentials,
            revision: s.credentials.revision + 1,
            ...(kind === 'db_key'
              ? { database: false, matched: 0, total: 0, missing: [] }
              : kind === 'image_xor'
                ? { imageXor: false }
                : { imageAes: false }),
          }
        : undefined,
      ...(kind === 'db_key'
        ? {
            testError: undefined,
            keyTarget: undefined,
            verifyState: 'idle' as const,
            verifyError: undefined,
            accounts: s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: false } : a)),
          }
        : {}),
    }))
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

/** Reset for tests. */
export function __resetWizardStoreForTests(): void {
  useWizardStore.getState().invalidateTarget()
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
    keyTarget: undefined,
    credentials: undefined,
    credentialsError: undefined,
    acquiring: false,
    acquireSteps: [...DEFAULT_KEY_STEPS],
    acquireStrategy: 'auto',
    acquireScope: 'database',
    credentialsLoading: false,
    acquireStartedAt: 0,
    acquireFailed: false,
    permissionDialog: false,
    testing: false,
    testError: undefined,
  })
}
