/**
 * Onboarding wizard state (zustand). Everything the user typed survives leaving the wizard because it is
 * mirrored into AppConfig.account through configStore (DESIGN-SPEC §5 退出向导需确认，已填内容本地保留).
 * Bridge calls live here so the components stay declarative.
 */
import { create } from 'zustand'
import type { AppConfig, KeyAcquireStep, WxAccount } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'
import { useConfigStore } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { DEFAULT_KEY_STEPS, EMPTY_KEYS, applyKeySteps, hasKey, mergeKeyStep, needsPermission, validateKeyHex, type KeyKind, type KeyStates, type WizardPage } from './gating'

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
  dismissPermissionDialog(): void
  setManualKey(kind: KeyKind, input: string): Promise<{ ok: boolean; error?: string }>
  clearKey(kind: KeyKind): void
  /** Test the connection; on success persist account + onboarding.completed. */
  testAndFinish(): Promise<boolean>
  clearTestError(): void
  /** Mirror what the user entered into AppConfig.account (called on exit). */
  persistDraft(): Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const KEY_REFS: Record<KeyKind, keyof AppConfig['account']> = { db_key: 'dbKeyRef', image_xor: 'imageXorKeyRef', image_aes: 'imageAesKeyRef' }

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
  permissionDialog: false,
  testing: false,

  async hydrate(config) {
    const acc = config.account
    const keys: KeyStates = { ...EMPTY_KEYS }
    await Promise.all(
      (Object.keys(KEY_REFS) as KeyKind[]).map(async (kind) => {
        const ref = acc[KEY_REFS[kind]] || ({ db_key: 'account:dbKey', image_xor: 'account:imageXorKey', image_aes: 'account:imageAesKey' } as const)[kind]
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
        set({ detecting: false, dbRootError: res.running ? '已检测到微信，但没有找到数据目录，请点击「浏览」手动选择' : '未检测到运行中的微信。请先打开并登录微信，或点击「浏览」手动选择目录' })
        return
      }
      set({ detecting: false, dbRoot: res.dbRoot, dbRootSource: 'auto', detectedVersion: res.version, verifyState: 'idle', verifyError: undefined })
      await get().loadAccounts()
    } catch (e) {
      set({ detecting: false, dbRootError: `检测失败：${errText(e)}` })
    }
  },

  async browse() {
    try {
      const dir = await invoke('app:pickDirectory', { title: '选择微信数据目录', defaultPath: get().dbRoot || undefined })
      if (!dir) return
      set({ dbRoot: dir, dbRootSource: 'manual', dbRootError: undefined, verifyState: 'idle', verifyError: undefined })
      await get().loadAccounts()
    } catch (e) {
      set({ dbRootError: errText(e) })
    }
  },

  setDbRoot(path) {
    set({ dbRoot: path, dbRootSource: path ? 'manual' : 'none', dbRootError: undefined, verifyState: 'idle', verifyError: undefined })
  },

  setCacheDir(path) {
    set({ cacheDir: path })
  },
  async browseCache() {
    const dir = await invoke('app:pickDirectory', { title: '选择缓存目录', defaultPath: get().cacheDir || undefined }).catch(() => null)
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
        verifyState: pick?.verified ? 'verified' : pick && get().verifyState === 'verified' && pick.wxid === current ? 'verified' : 'idle',
        accountsError: accounts.length === 0 ? '这个目录下没有检测到微信账号，请确认路径是否正确' : undefined,
      })
    } catch (e) {
      set({ accountsLoading: false, accounts: [], accountsError: `读取账号失败：${errText(e)}` })
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
        set((s) => ({ verifyState: 'verified', accounts: s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: true } : a)) }))
        return true
      }
      set({ verifyState: 'failed', verifyError: res.error ?? '该 wxid 与所选数据库目录不匹配，请重新选择或验证' })
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
    set({ acquiring: true, acquireStrategy: strategy, acquireSteps: DEFAULT_KEY_STEPS.map((s) => ({ ...s })), permissionDialog: false })
    const bridge = await getBridge()
    const off = bridge.on('substrate:keyStep', (step) => {
      if (my !== acquireEpoch) return
      set((s) => ({ acquireSteps: mergeKeyStep(s.acquireSteps, step) }))
    })
    try {
      const steps = await invoke('substrate:acquireKeys', { wxid, dbRoot, strategy })
      if (my !== acquireEpoch) return
      const finalSteps = steps.length ? steps : get().acquireSteps
      const keys = applyKeySteps(get().keys, finalSteps)
      const verifyStep = finalSteps.find((s) => s.id === 'verify')
      set((s) => ({
        acquiring: false,
        acquireSteps: finalSteps,
        keys,
        permissionDialog: needsPermission(finalSteps),
        verifyState: verifyStep?.status === 'done' ? 'verified' : s.verifyState,
        accounts: verifyStep?.status === 'done' ? s.accounts.map((a) => (a.wxid === wxid ? { ...a, verified: true } : a)) : s.accounts,
      }))
    } catch (e) {
      if (my !== acquireEpoch) return
      const msg = errText(e)
      set((s) => ({
        acquiring: false,
        acquireSteps: s.acquireSteps.map((st) => (st.status === 'doing' || st.status === 'todo' ? { ...st, status: 'failed', detail: msg } : st)),
        keys: applyKeySteps(s.keys, s.acquireSteps.map((st) => (st.status === 'doing' || st.status === 'todo' ? { ...st, status: 'failed', detail: msg } : st))),
        permissionDialog: /权限|permission|full disk|完全磁盘/i.test(msg),
      }))
    } finally {
      off()
    }
  },

  cancelAcquire() {
    acquireEpoch++
    set((s) => ({ acquiring: false, acquireSteps: s.acquireSteps.map((st) => (st.status === 'doing' ? { ...st, status: 'todo', detail: undefined } : st)) }))
  },

  dismissPermissionDialog() {
    set({ permissionDialog: false })
  },

  async setManualKey(kind, input) {
    const v = validateKeyHex(kind, input)
    if (!v.ok) return { ok: false, error: v.error }
    try {
      const res = await invoke('substrate:setManualKey', { kind, hex: v.hex })
      if (!res.ok) return { ok: false, error: res.error ?? '密钥无效' }
      set((s) => ({ keys: { ...s.keys, [kind]: { status: 'manual', hex: v.hex } }, testError: undefined, ...(kind === 'db_key' ? { verifyState: 'idle' as const, verifyError: undefined, accounts: s.accounts.map((a) => ({ ...a, verified: false })) } : {}) }))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errText(e) }
    }
  },

  clearKey(kind) {
    set((s) => ({ keys: { ...s.keys, [kind]: { status: 'missing' } } }))
  },

  async testAndFinish() {
    const { wxid, dbRoot, cacheDir } = get()
    set({ testing: true, testError: undefined })
    try {
      const res = await invoke('substrate:testConnection', { wxid, dbRoot })
      if (!res.ok) {
        set({ testing: false, testError: res.error ?? '无法打开数据库' })
        return false
      }
      await useConfigStore.getState().set({
        account: { wxid, dbRoot, cacheDir: cacheDir || undefined, verifiedAt: Date.now() },
      })
      const connected = await invoke('substrate:connect', undefined)
      if (!connected.ok) {
        set({ testing: false, testError: connected.error ?? '密钥验证通过，但数据库连接失败' })
        return false
      }
      await useConfigStore.getState().set({ onboarding: { completed: true } })
      set({ testing: false })
      return true
    } catch (e) {
      set({ testing: false, testError: errText(e) })
      return false
    }
  },

  clearTestError() {
    set({ testError: undefined })
  },

  async persistDraft() {
    const { wxid, dbRoot, cacheDir } = get()
    try {
      await useConfigStore.getState().set({ account: { wxid: wxid || undefined, dbRoot: dbRoot || undefined, cacheDir: cacheDir || undefined } })
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
    permissionDialog: false,
    testing: false,
    testError: undefined,
  })
}
