/**
 * 账号 — current account card, database configuration (key / root / verification) and cache + image
 * keys. Figma 128:462, board 151:415 ③. Validated actions use explicit buttons; paths are mono.
 */
import { FolderOpen, KeyRound, Link, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Image } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WxAccount } from '@aiwc/protocol'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineHint,
  Input,
  Select,
  Skeleton,
  toast,
  type SelectOption,
} from '@/kit'
import { useT } from '@/i18n'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { toMediaUrl } from '@/platform/mediaUrl'
import { useConfig } from '@/platform/configStore'
import { invoke, useInvoke } from '@/platform/hooks'
import { secretRefFor, type KeyKind } from '../accountModel'
import { activateAccount, errorMessage, refreshConfig, saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'
import { AcquireKeysButton, InlineKeyAcquire, SecretField } from './AccountKeys'
import { DatabaseCredentialStatus, SavedDatabaseCredentials } from './DatabaseCredentialStatus'
import { OfficeSection } from './OfficeSection'
import { MobileSection } from './MobileSection'

export function AccountPage() {
  const t = useT()
  const account = useConfig((c) => c.account)
  const status = useAccountStatus()
  const accounts = useInvoke('substrate:listAccounts', { dbRoot: account?.dbRoot }, [account?.dbRoot])
  const [switching, setSwitching] = useState(false)
  const [keyVersion, setKeyVersion] = useState(0)
  const [acquire, setAcquire] = useState<'database' | 'image' | null>(null)
  const [verifyWxid, setVerifyWxid] = useState<string | undefined>(account?.wxid)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | undefined>()
  const [testing, setTesting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [resetCache, setResetCache] = useState(false)
  const credentials = useInvoke(
    'substrate:credentialStatus',
    { wxid: account?.wxid ?? '', dbRoot: account?.dbRoot ?? '' },
    [account?.wxid, account?.dbRoot, account?.credentialRevision, keyVersion],
    { enabled: Boolean(account?.wxid && account.dbRoot) },
  )

  useEffect(() => {
    if (account?.wxid) setVerifyWxid(account.wxid)
  }, [account?.wxid])

  if (!account) return <PagePlaceholder rows={4} />

  const list = accounts.data ?? []
  const current = status.data?.connection === 'ready' ? status.data.account : undefined
  const activeWxid = current?.wxid
  const mismatch = Boolean(activeWxid && activeWxid !== account.wxid)
  const accountOptions: SelectOption[] = list.map((a) => ({
    value: a.wxid,
    label: a.nickname ?? a.wxid,
    description: a.wxid,
    badge: a.verified ? (
      <Badge tone="ok">{t('settings.account.verified')}</Badge>
    ) : (
      <Badge tone="warn">{t('settings.account.unverified')}</Badge>
    ),
  }))

  const switchAccount = async (wxid: string) => {
    const target = list.find((a) => a.wxid === wxid)
    if (!target) return
    if (switching) return
    setSwitching(true)
    try {
      if (await activateAccount({ wxid, dbRoot: target.dbRoot, verifiedAt: target.verified ? Date.now() : 0 })) {
        setVerifyError(undefined)
        setAcquire(null)
        accounts.reload()
        toast.success(t('settings.account.switched', { name: target.nickname ?? target.wxid }))
      }
    } finally {
      setSwitching(false)
    }
  }

  const rescan = async () => {
    setScanning(true)
    try {
      accounts.reload()
      const detected = await invoke('substrate:detectWeChat', undefined)
      if (detected.dbRoot && detected.dbRoot !== account.dbRoot)
        await saveConfig({ account: { dbRoot: detected.dbRoot } })
      const found = await invoke('substrate:listAccounts', { dbRoot: detected.dbRoot ?? account.dbRoot })
      toast.success(
        t(detected.running ? 'settings.account.scan.done' : 'settings.account.scan.doneNotRunning', {
          n: found.length,
        }),
      )
    } catch (e) {
      toast.error(t('settings.account.scan.failed'), { detail: errorMessage(e) })
    } finally {
      setScanning(false)
    }
  }

  const pickDir = async (kind: 'dbRoot' | 'cacheDir') => {
    try {
      const picked = await invoke('app:pickDirectory', {
        title: kind === 'dbRoot' ? t('settings.account.dbRoot.pickTitle') : t('settings.account.cacheDir.pickTitle'),
        defaultPath: kind === 'dbRoot' ? account.dbRoot : account.cacheDir,
      })
      if (!picked) return
      await saveConfig({
        account: kind === 'dbRoot' ? { dbRoot: picked, verifiedAt: undefined } : { cacheDir: picked },
      })
    } catch (e) {
      toast.error(t('settings.account.pickDirFailed'), { detail: errorMessage(e) })
    }
  }

  const verify = async () => {
    if (!verifyWxid || !account.dbRoot) {
      setVerifyError(t('settings.account.verify.selectFirst'))
      return
    }
    setVerifying(true)
    setVerifyError(undefined)
    try {
      const res = await invoke('substrate:verifyAccount', { wxid: verifyWxid, dbRoot: account.dbRoot })
      if (res.ok) {
        if (!(await activateAccount({ wxid: verifyWxid, dbRoot: account.dbRoot, verifiedAt: Date.now() }))) return
        toast.success(t('settings.account.verify.passed'))
      } else {
        setVerifyError(res.error ?? t('settings.account.verify.mismatch'))
        toast.error(t('settings.account.verify.failed'))
      }
    } catch (e) {
      setVerifyError(errorMessage(e))
    } finally {
      setVerifying(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const target = { wxid: verifyWxid ?? account.wxid ?? '', dbRoot: account.dbRoot ?? '' }
      const res = await invoke('substrate:testConnection', target)
      if (res.ok) {
        if (!(await activateAccount({ ...target, verifiedAt: Date.now() }))) return
        setVerifyError(undefined)
        toast.success(t('settings.account.verify.connected'))
      } else {
        setVerifyError(res.error ?? t('settings.account.verify.connectFailed'))
        toast.error(t('settings.account.verify.connectFailed'), { detail: res.error })
      }
    } catch (e) {
      toast.error(t('settings.account.verify.connectFailed'), { detail: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const afterKeys = () => {
    setKeyVersion((v) => v + 1)
    void refreshConfig()
  }

  return (
    <>
      <AccountCard
        account={current}
        wxid={activeWxid ?? account.wxid}
        dbRoot={current?.dbRoot ?? account.dbRoot}
        loading={accounts.loading}
        options={accountOptions}
        onSwitch={(w) => void switchAccount(w)}
        onRescan={() => void rescan()}
        scanning={scanning}
        switching={switching}
      />

      {/* Part of the page when it opens, not a reply to input: shown, with a way out, but not announced as an alert. */}
      {accounts.error ? (
        <div className="flex flex-wrap items-center gap-2">
          <InlineHint kind="error" live={false} className="min-w-0 flex-1">
            {t('settings.account.listFailed', { detail: errorMessage(accounts.error) })}
          </InlineHint>
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={accounts.reload} loading={accounts.loading}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {mismatch ? <InlineHint kind="warning">{t('settings.account.mismatch')}</InlineHint> : null}
      <Section title={t('settings.account.sections.dirs')}>
        <Card variant="rows">
          <SRow
            id="account.dbRoot"
            title={t('settings.account.dbRoot.title')}
            help={t('settings.account.dbRoot.help')}
            stacked
          >
            <Input
              mono
              readOnly
              size="sm"
              aria-label={t('settings.account.dbRoot.title')}
              value={account.dbRoot ?? ''}
              placeholder={t('settings.account.dbRoot.unset')}
              trailing={
                <IconButton
                  size="xs"
                  icon={FolderOpen}
                  label={t('settings.account.dbRoot.browse')}
                  onClick={() => void pickDir('dbRoot')}
                  className="text-fg-3"
                />
              }
            />
          </SRow>
          <SRow
            id="account.cacheDir"
            title={t('settings.account.cacheDir.title')}
            help={t('settings.account.cacheDir.help')}
            stacked
          >
            <Input
              mono
              readOnly
              size="sm"
              aria-label={t('settings.account.cacheDir.title')}
              value={account.cacheDir ?? ''}
              placeholder={t('settings.account.cacheDir.placeholder')}
              trailing={
                <>
                  <IconButton
                    size="xs"
                    icon={FolderOpen}
                    label={t('settings.account.cacheDir.pick')}
                    onClick={() => void pickDir('cacheDir')}
                    className="text-fg-3"
                  />
                  <IconButton
                    size="xs"
                    icon={RotateCcw}
                    label={t('settings.account.cacheDir.reset')}
                    disabled={!account.cacheDir}
                    onClick={() => setResetCache(true)}
                    className="text-fg-3"
                  />
                </>
              }
            />
          </SRow>
          <SRow
            id="account.verify"
            title={t('settings.account.verify.title')}
            badge={
              !mismatch && current?.verified && account.verifiedAt ? (
                <Badge tone="ok">{t('settings.account.verified')}</Badge>
              ) : (
                <Badge tone="warn">{t('settings.account.unverified')}</Badge>
              )
            }
            help={t('settings.account.verify.help')}
            stacked
            footer={verifyError ? <InlineHint kind="error">{verifyError}</InlineHint> : null}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label={t('settings.account.verify.wxidLabel')}
                options={accountOptions}
                value={verifyWxid ?? null}
                onValueChange={setVerifyWxid}
                placeholder={accounts.loading ? t('settings.account.loading') : t('settings.account.verify.selectWxid')}
                className="min-w-[220px] font-mono"
              />
              {/* Sibling checks share one level (outline, CLAUDE.md §2.2); the connection test is the quieter extra. */}
              <Button variant="outline" icon={ScanLine} onClick={() => void rescan()} loading={scanning}>
                {t('settings.account.verify.scanDir')}
              </Button>
              <Button
                variant="outline"
                icon={ShieldCheck}
                onClick={() => void verify()}
                loading={verifying}
                disabled={!verifyWxid}
              >
                {t('settings.account.verify.verify')}
              </Button>
              <Button variant="ghost" icon={Link} onClick={() => void testConnection()} loading={testing}>
                {t('settings.account.verify.testConnection')}
              </Button>
            </div>
          </SRow>
        </Card>
      </Section>

      <Section title={t('settings.account.sections.keys')}>
        <Card variant="rows">
          <SRow
            id="account.dbKey"
            title={t('settings.account.dbKey.title')}
            description={t('settings.account.dbKey.description')}
            help={t('settings.account.dbKey.help')}
            stacked
            footer={
              <>
                <DatabaseCredentialStatus credentials={credentials.data} />
                {acquire === 'database' ? (
                  <InlineKeyAcquire
                    key="acquire-all"
                    wxid={account.wxid}
                    dbRoot={account.dbRoot}
                    scope="database"
                    onFinished={afterKeys}
                    onManual={(kind) => document.getElementById(`account-key-${kind}`)?.focus()}
                    onClose={() => setAcquire(null)}
                  />
                ) : null}
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {account.dbCredentialsRef ? (
                <SavedDatabaseCredentials />
              ) : (
                <SecretField
                  kind="db_key"
                  secretRef={secretRefFor(account, 'db_key')}
                  version={keyVersion}
                  onSaved={afterKeys}
                  label={t('settings.account.dbKey.fieldLabel')}
                  className="min-w-[200px] flex-1"
                />
              )}
              <AcquireKeysButton
                secretRef={secretRefFor(account, 'db_key')}
                version={keyVersion}
                available={credentials.data?.database}
                icon={KeyRound}
                onClick={() => setAcquire('database')}
              >
                {t('settings.account.dbKey.acquire')}
              </AcquireKeysButton>
            </div>
          </SRow>

          <SRow
            id="account.imageKeys"
            title={t('settings.account.imageKeys.title')}
            help={t('settings.account.imageKeys.help')}
            stacked
            footer={
              <>
                {acquire === 'image' ? (
                  <InlineKeyAcquire
                    key="acquire-image"
                    wxid={account.wxid}
                    dbRoot={account.dbRoot}
                    scope="image"
                    onFinished={afterKeys}
                    onManual={(kind) => document.getElementById(`account-key-${kind}`)?.focus()}
                    onClose={() => setAcquire(null)}
                  />
                ) : null}
              </>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <LabeledSecret
                label={t('settings.account.imageKeys.xor')}
                kind="image_xor"
                secretRef={secretRefFor(account, 'image_xor')}
                version={keyVersion}
                onSaved={afterKeys}
                className="w-[120px]"
              />
              <LabeledSecret
                label={t('settings.account.imageKeys.aes')}
                kind="image_aes"
                secretRef={secretRefFor(account, 'image_aes')}
                version={keyVersion}
                onSaved={afterKeys}
                className="min-w-[200px] flex-1"
              />
              <AcquireKeysButton
                secretRef={secretRefFor(account, 'image_aes')}
                version={keyVersion}
                icon={Image}
                onClick={() => setAcquire('image')}
              >
                {t('settings.account.imageKeys.acquire')}
              </AcquireKeysButton>
            </div>
          </SRow>
        </Card>
      </Section>

      <OfficeSection />

      <MobileSection />

      <ConfirmDialog
        open={resetCache}
        onOpenChange={setResetCache}
        title={t('settings.account.cacheDir.resetTitle')}
        description={t('settings.account.cacheDir.resetDescription')}
        confirmLabel={t('settings.account.cacheDir.resetConfirm')}
        onConfirm={async () => {
          if (await saveConfig({ account: { cacheDir: '' } })) toast.success(t('settings.account.cacheDir.resetDone'))
          setResetCache(false)
        }}
      />
    </>
  )
}

function LabeledSecret({
  label,
  className,
  ...rest
}: {
  label: string
  kind: KeyKind
  secretRef: string
  version: number
  onSaved: () => void
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-micro text-fg-3">{label}</span>
      <SecretField label={label} {...rest} />
    </div>
  )
}

interface AccountCardProps {
  account: WxAccount | undefined
  wxid: string | undefined
  dbRoot: string | undefined
  loading: boolean
  options: SelectOption[]
  onSwitch: (wxid: string) => void
  onRescan: () => void
  scanning: boolean
  switching: boolean
}

function AccountCard({
  account,
  wxid,
  dbRoot,
  loading,
  options,
  onSwitch,
  onRescan,
  scanning,
  switching,
}: AccountCardProps) {
  const t = useT()
  if (!account && !wxid) {
    return (
      <Card>
        {loading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-item" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-52" />
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            variant="empty"
            title={t('settings.account.card.emptyTitle')}
            description={t('settings.account.card.emptyDescription')}
            action={{ label: t('settings.account.card.rescan'), onClick: onRescan, icon: RefreshCw, variant: 'ghost' }}
          />
        )}
      </Card>
    )
  }
  const name = account?.nickname ?? wxid ?? ''
  const id = account?.wxid ?? wxid ?? ''
  return (
    <Card data-setting-row="account.current" className="flex flex-wrap items-center gap-3">
      <Avatar id={id} name={name} src={toMediaUrl(account?.avatarPath)} size={44} />
      <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-bubble font-medium leading-5 text-fg">{name}</span>
          <Badge tone={account?.verified ? 'ok' : 'warn'}>
            {account?.verified ? t('settings.account.card.active') : t('settings.account.unverified')}
          </Badge>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-micro text-fg-3">
          <span className="shrink-0">{t('settings.account.card.wechatId')}</span>
          <span className="min-w-0 truncate font-mono" title={id}>
            {id}
          </span>
        </div>
        <div className="truncate font-mono text-micro text-fg-3" title={dbRoot}>
          {dbRoot ? dbRoot : t('settings.account.card.dbRootUnset')}
        </div>
      </div>
      {/* In a narrow settings column the switcher drops to its own row instead of squeezing the name to nothing. */}
      <div className="flex shrink-0 flex-col items-end gap-2 @max-[720px]/settings:w-full @max-[720px]/settings:flex-row @max-[720px]/settings:items-center">
        <Select
          disabled={switching}
          aria-label={t('settings.account.card.switch')}
          options={options}
          value={wxid ?? null}
          onValueChange={onSwitch}
          placeholder={loading ? t('settings.account.loading') : t('settings.account.card.switch')}
          align="end"
          className="min-w-[140px] max-w-[220px]"
        />
        <Button variant="ghost" icon={RefreshCw} onClick={onRescan} loading={scanning}>
          {t('settings.account.card.rescan')}
        </Button>
      </div>
    </Card>
  )
}
