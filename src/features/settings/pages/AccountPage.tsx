/**
 * 账号 — current account card, database configuration (key / root / verification) and cache + image
 * keys. Figma 128:462, board 151:415 ③. Validated actions use explicit buttons; paths are mono.
 */
import { FolderOpen, KeyRound, Link, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Image } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WxAccount } from '@aiwc/protocol'
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, InlineHint, Input, Select, Skeleton, toast, type SelectOption } from '@/kit'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { toMediaUrl } from '@/platform/mediaUrl'
import { useConfig } from '@/platform/configStore'
import { truncateMiddle } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import { secretRefFor, type KeyKind } from '../accountModel'
import { activateAccount, errorMessage, refreshConfig, saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'
import { InlineKeyAcquire, ManualKeyForm, SecretField } from './AccountKeys'

export function AccountPage() {
  const account = useConfig((c) => c.account)
  const status = useAccountStatus()
  const accounts = useInvoke('substrate:listAccounts', { dbRoot: account?.dbRoot }, [account?.dbRoot])
  const [switching, setSwitching] = useState(false)
  const [keyVersion, setKeyVersion] = useState(0)
  const [acquire, setAcquire] = useState<'all' | 'image' | null>(null)
  const [manual, setManual] = useState<KeyKind | null>(null)
  const [verifyWxid, setVerifyWxid] = useState<string | undefined>(account?.wxid)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | undefined>()
  const [testing, setTesting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [resetCache, setResetCache] = useState(false)

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
    badge: a.verified ? <Badge tone="ok">已验证</Badge> : <Badge tone="warn">未验证</Badge>,
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
        setManual(null)
        accounts.reload()
        toast.success(`已切换到「${target.nickname ?? target.wxid}」并刷新会话`)
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
      if (detected.dbRoot && detected.dbRoot !== account.dbRoot) await saveConfig({ account: { dbRoot: detected.dbRoot } })
      const found = await invoke('substrate:listAccounts', { dbRoot: detected.dbRoot ?? account.dbRoot })
      toast.success(`扫描完成 · 发现 ${found.length} 个账号${detected.running ? '' : ' · 微信未运行'}`)
    } catch (e) {
      toast.error('扫描失败', { detail: errorMessage(e) })
    } finally {
      setScanning(false)
    }
  }

  const pickDir = async (kind: 'dbRoot' | 'cacheDir') => {
    try {
      const picked = await invoke('app:pickDirectory', { title: kind === 'dbRoot' ? '选择微信数据库根目录' : '选择缓存目录', defaultPath: kind === 'dbRoot' ? account.dbRoot : account.cacheDir })
      if (!picked) return
      await saveConfig({ account: kind === 'dbRoot' ? { dbRoot: picked, verifiedAt: undefined } : { cacheDir: picked } })
    } catch (e) {
      toast.error('选择目录失败', { detail: errorMessage(e) })
    }
  }

  const verify = async () => {
    if (!verifyWxid || !account.dbRoot) {
      setVerifyError('请先选择 wxid 与数据库根目录')
      return
    }
    setVerifying(true)
    setVerifyError(undefined)
    try {
      const res = await invoke('substrate:verifyAccount', { wxid: verifyWxid, dbRoot: account.dbRoot })
      if (res.ok) {
        if (!await activateAccount({ wxid: verifyWxid, dbRoot: account.dbRoot, verifiedAt: Date.now() })) return
        toast.success('账号验证通过 · 已保存为当前账号')
      } else {
        setVerifyError(res.error ?? '该目录与所选 wxid 不匹配')
        toast.error('账号验证失败')
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
        if (!await activateAccount({ ...target, verifiedAt: Date.now() })) return
        setVerifyError(undefined)
        toast.success('连接成功 · 数据库可读')
      }
      else {
        setVerifyError(res.error ?? '连接失败')
        toast.error('连接失败', { detail: res.error })
      }
    } catch (e) {
      toast.error('连接失败', { detail: errorMessage(e) })
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
      <AccountCard account={current} wxid={activeWxid ?? account.wxid} dbRoot={current?.dbRoot ?? account.dbRoot} loading={accounts.loading} options={accountOptions} onSwitch={(w) => void switchAccount(w)} onRescan={() => void rescan()} scanning={scanning} switching={switching} />

      {mismatch ? <InlineHint kind="warning">配置账号与当前连接不一致，请在上方选择要连接的账号。</InlineHint> : null}
      <Section title="目录与账号验证">
        <Card variant="rows">
          <SRow id="account.dbRoot" title="数据库根目录" description="微信账号数据所在目录，通常是包含 db_storage 的目录" stacked>
            <Input mono readOnly size="sm" aria-label="数据库根目录" value={account.dbRoot ?? ''} placeholder="未设置 · 点击右侧图标选择" trailing={<IconButton size="xs" icon={FolderOpen} label="浏览" onClick={() => void pickDir('dbRoot')} className="text-fg-3" />} />
          </SRow>
          <SRow id="account.cacheDir" title="缓存目录" description="可选，留空时使用默认目录；建议选择空间充足的磁盘" stacked>
            <Input
              mono
              readOnly
              size="sm"
              aria-label="缓存目录"
              value={account.cacheDir ?? ''}
              placeholder="默认目录（应用数据目录下的 cache）"
              trailing={
                <>
                  <IconButton size="xs" icon={FolderOpen} label="选择目录" onClick={() => void pickDir('cacheDir')} className="text-fg-3" />
                  <IconButton size="xs" icon={RotateCcw} label="恢复默认" disabled={!account.cacheDir} onClick={() => setResetCache(true)} className="text-fg-3" />
                </>
              }
            />
          </SRow>
          <SRow
            id="account.verify"
            title="账号验证"
            badge={!mismatch && current?.verified && account.verifiedAt ? <Badge tone="ok">已验证</Badge> : <Badge tone="warn">未验证</Badge>}
            description="确认 wxid 与数据库目录匹配，验证成功后才会保存为当前账号配置"
            stacked
            footer={verifyError ? <InlineHint kind="error">{verifyError}</InlineHint> : null}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="待验证的 wxid" options={accountOptions} value={verifyWxid ?? null} onValueChange={setVerifyWxid} placeholder={accounts.loading ? '读取中…' : '选择 wxid'} className="min-w-[220px] font-mono" />
              <Button variant="ghost" icon={ScanLine} onClick={() => void rescan()} loading={scanning}>
                扫描目录
              </Button>
              <Button variant="ghost" icon={ShieldCheck} onClick={() => void verify()} loading={verifying} disabled={!verifyWxid}>
                验证账号
              </Button>
              <Button variant="link" icon={Link} onClick={() => void testConnection()} loading={testing}>
                测试连接
              </Button>
            </div>
          </SRow>
        </Card>
      </Section>

      <Section title="解密密钥">
        <Card variant="rows">
          <SRow
            id="account.dbKey"
            title="数据库解密密钥"
            description="64 位十六进制密钥，用于验证当前账号数据库连接"
            stacked
            footer={
              <>
                {acquire === 'all' ? (
                  <InlineKeyAcquire key="acquire-all" wxid={account.wxid} dbRoot={account.dbRoot} scope="all" onFinished={afterKeys} onManual={setManual} onClose={() => setAcquire(null)} />
                ) : null}
                {manual === 'db_key' ? <ManualKeyForm kind="db_key" onSaved={() => { setManual(null); afterKeys() }} onCancel={() => setManual(null)} /> : null}
              </>
            }
          >
            <div className="flex items-center gap-2">
              <SecretField kind="db_key" secretRef={secretRefFor(account, 'db_key')} version={keyVersion} label="解密密钥" className="flex-1" />
              <Button variant="primary" icon={KeyRound} onClick={() => setAcquire('all')}>
                自动获取密钥
              </Button>
              <Button variant="link" onClick={() => setManual(manual === 'db_key' ? null : 'db_key')}>
                手动输入
              </Button>
            </div>
          </SRow>

          <SRow
            id="account.imageKeys"
            title="图片解密密钥"
            description="优先走 kvcomm + wxid 验真，失败时回退到微信进程内存扫描"
            stacked
            footer={
              <>
                {acquire === 'image' ? (
                  <InlineKeyAcquire key="acquire-image" wxid={account.wxid} dbRoot={account.dbRoot} scope="image" onFinished={afterKeys} onManual={setManual} onClose={() => setAcquire(null)} />
                ) : null}
                {manual && manual !== 'db_key' ? <ManualKeyForm kind={manual} onSaved={() => { setManual(null); afterKeys() }} onCancel={() => setManual(null)} /> : null}
              </>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <LabeledSecret label="XOR 密钥" kind="image_xor" secretRef={secretRefFor(account, 'image_xor')} version={keyVersion} className="w-[120px]" />
              <LabeledSecret label="AES 密钥" kind="image_aes" secretRef={secretRefFor(account, 'image_aes')} version={keyVersion} className="min-w-[200px] flex-1" />
              <Button variant="ghost" icon={Image} onClick={() => setAcquire('image')}>
                自动获取图片密钥
              </Button>
              <Button variant="link" onClick={() => setManual(manual === 'image_xor' ? null : 'image_xor')}>手动输入 XOR</Button>
              <Button variant="link" onClick={() => setManual(manual === 'image_aes' ? null : 'image_aes')}>手动输入 AES</Button>
            </div>
          </SRow>
        </Card>
      </Section>

      <ConfirmDialog
        open={resetCache}
        onOpenChange={setResetCache}
        title="恢复默认缓存目录？"
        description="将改回应用数据目录下的 cache，已有缓存不会自动移动。"
        confirmLabel="恢复"
        onConfirm={async () => {
          if (await saveConfig({ account: { cacheDir: '' } })) toast.success('已恢复默认缓存目录')
          setResetCache(false)
        }}
      />
    </>
  )
}

function LabeledSecret({ label, className, ...rest }: { label: string; kind: KeyKind; secretRef: string; version: number; className?: string }) {
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

function AccountCard({ account, wxid, dbRoot, loading, options, onSwitch, onRescan, scanning, switching }: AccountCardProps) {
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
          <EmptyState compact variant="empty" title="尚未检测到微信账号" description="确认微信已登录，然后重新扫描本机目录" action={{ label: '重新扫描', onClick: onRescan, icon: RefreshCw, variant: 'ghost' }} />
        )}
      </Card>
    )
  }
  const name = account?.nickname ?? wxid ?? ''
  const id = account?.wxid ?? wxid ?? ''
  return (
    <Card data-setting-row="account.current" className="flex items-center gap-3">
      <Avatar id={id} name={name} src={toMediaUrl(account?.avatarPath)} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-bubble font-medium leading-5 text-fg">{name}</span>
          <Badge tone={account?.verified ? 'ok' : 'warn'}>{account?.verified ? '当前激活' : '未验证'}</Badge>
        </div>
        <div className="flex items-center gap-2 text-micro text-fg-3">
          <span className="shrink-0">微信 ID</span>
          <span className="truncate font-mono" title={id}>
            {id}
          </span>
        </div>
        <div className="truncate font-mono text-micro text-fg-3" title={dbRoot}>
          {dbRoot ? truncateMiddle(dbRoot, 56) : '数据库根目录未设置'}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Select disabled={switching} aria-label="切换账号" options={options} value={wxid ?? null} onValueChange={onSwitch} placeholder={loading ? '读取中…' : '切换账号'} align="end" className="min-w-[140px]" />
        <Button variant="ghost" icon={RefreshCw} onClick={onRescan} loading={scanning}>
          重新扫描
        </Button>
      </div>
    </Card>
  )
}
