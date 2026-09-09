/**
 * Card ① 微信与账号 (Figma 135:415 上半 / 155:415 ①): database path (自动获取 / 浏览), optional cache dir
 * (恢复默认), account Select with verified badges + 验证 / 重新扫描.
 */
import { CircleCheck, ExternalLink, Folder, FolderOpen, RefreshCw, RotateCcw, Sparkles, UserRound } from 'lucide-react'
import { Avatar, Badge, Button, Card, FieldLabel, InlineHint, Input, Select, type SelectOption } from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { openLocalPath } from '@/platform/openExternal'
import { useWizardStore } from './wizardStore'

export function AccountCard() {
  const s = useWizardStore()

  const pathStatus = s.detecting
    ? undefined
    : s.dbRootSource === 'auto'
      ? { kind: 'success' as const, text: '已自动获取' }
      : s.dbRootSource === 'cached'
        ? { kind: 'success' as const, text: '已从缓存加载' }
        : s.dbRootSource === 'manual'
          ? { kind: 'info' as const, text: '手动选择' }
          : undefined

  const accountOptions: SelectOption[] = s.accounts.map((a) => ({
    value: a.wxid,
    label: a.nickname || '微信用户（昵称暂不可用）',
    description: a.wxid,
    leading: <Avatar id={a.wxid} name={a.nickname || '微信用户'} src={toMediaUrl(a.avatarPath)} size={28} />,
    badge: a.verified ? <Badge tone="ok">已验证</Badge> : <Badge tone="warn">未验证</Badge>,
  }))

  const verified = s.verifyState === 'verified'

  return (
    <Card className="flex flex-col gap-4">
      {/* 微信数据库路径 */}
      <div className="flex flex-col gap-2">
        <FieldLabel
          icon={Folder}
          label="微信数据库路径"
          help="微信 → 设置 → 账号与储存 → 储存位置，可查看该目录"
          hint="可手动修改（获取方式：微信 → 设置 → 账号与储存 → 储存位置）"
          status={pathStatus}
          htmlFor="ob-dbroot"
        />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Input
            id="ob-dbroot"
            mono
            value={s.detecting ? '' : s.dbRoot}
            placeholder={s.detecting ? '正在检测微信进程…' : '未找到微信数据目录，请自动获取或手动选择'}
            onChange={(e) => s.setDbRoot(e.target.value)}
            onBlur={() => void s.loadAccounts()}
            disabled={s.detecting}
            error={Boolean(s.dbRootError)}
            wrapperClassName="flex-1"
            aria-label="微信数据库路径"
          />
          <Button variant="ghost" icon={FolderOpen} onClick={() => void s.browse()} disabled={s.detecting}>
            浏览
          </Button>
          <Button icon={s.dbRootError ? RefreshCw : Sparkles} loading={s.detecting} onClick={() => void s.detect()}>
            {s.detecting ? '获取中…' : s.dbRootError ? '重试' : '自动获取'}
          </Button>
        </div>
        {s.dbRootError ? (
          <InlineHint kind="error">{s.dbRootError}</InlineHint>
        ) : s.detecting ? (
          <InlineHint kind="info">正在读取微信的储存位置…</InlineHint>
        ) : s.dbRoot ? (
          <div className="flex items-center gap-3">
            {s.detectedVersion ? <span className="text-note text-fg-3">微信 {s.detectedVersion}</span> : null}
            <Button variant="link" size="sm" trailingIcon={ExternalLink} onClick={() => void openLocalPath(s.dbRoot, '数据目录')} className="-ml-2">
              打开此文件夹
            </Button>
          </div>
        ) : null}
      </div>

      {/* 缓存目录 */}
      <div className="flex flex-col gap-2">
        <FieldLabel icon={Folder} label="缓存目录" help="解密后的数据库副本、图片与索引都放在这里" hint="可选，留空使用默认目录；存放解密后的数据与索引，建议选择空间充足的磁盘" htmlFor="ob-cache" />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Input id="ob-cache" mono value={s.cacheDir} placeholder={s.defaultCacheDir ? `默认：${s.defaultCacheDir}` : '默认：应用数据目录'} onChange={(e) => s.setCacheDir(e.target.value)} wrapperClassName="flex-1" aria-label="缓存目录" />
          <Button variant="ghost" icon={FolderOpen} onClick={() => void s.browseCache()}>
            浏览
          </Button>
          <Button variant="ghost" icon={RotateCcw} onClick={s.resetCacheDir} disabled={!s.cacheDir}>
            恢复默认
          </Button>
        </div>
      </div>

      {/* 微信账号 */}
      <div className="flex flex-col gap-2">
        <FieldLabel
          icon={UserRound}
          label="微信账号 (Wxid)"
          help="同一台电脑登录过的每个微信账号在数据目录下各有一个 wxid_ 开头的文件夹"
          hint={s.accounts.length === 0 && s.dbRoot && !s.accountsLoading ? '没有检测到微信号？' : `该目录下检测到 ${s.accounts.length} 个账号`}
          status={verified ? { kind: 'success', text: '已验证' } : s.verifyState === 'failed' ? { kind: 'error', text: '未验证' } : s.wxid ? { kind: 'warning', text: '未验证' } : undefined}
          htmlFor="ob-wxid"
        />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Select
            id="ob-wxid"
            options={accountOptions}
            value={s.wxid || null}
            onValueChange={s.selectWxid}
            placeholder={s.accountsLoading ? '扫描中…' : s.dbRoot ? '选择账号' : '先选择数据库路径'}
            disabled={!s.dbRoot || s.accountsLoading}
            fullWidth
            size="lg"
            searchable={s.accounts.length > 6}
            className="h-auto min-h-12 flex-1 py-1.5"
            aria-label="微信账号"
            renderValue={(o) => o ? (
              <span className="flex min-w-0 items-center gap-2 text-left">
                {o.leading}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium">{o.label}</span>
                  <span className="truncate font-mono text-micro text-fg-3">{o.value}</span>
                </span>
              </span>
            ) : undefined}
          />
          {verified ? (
            <Button variant="ghost" icon={RefreshCw} loading={s.accountsLoading} onClick={() => void s.loadAccounts()} disabled={!s.dbRoot}>
              重新扫描
            </Button>
          ) : (
            <Button icon={CircleCheck} loading={s.verifyState === 'verifying'} onClick={() => void s.verify()} disabled={!s.wxid || !s.dbRoot}>
              验证账号
            </Button>
          )}
        </div>
        {s.accountsError ? (
          <InlineHint kind="error">{s.accountsError}</InlineHint>
        ) : s.verifyState === 'failed' ? (
          <InlineHint kind="error">{s.verifyError ?? '该 wxid 与所选数据库目录不匹配，请重新选择或验证'}</InlineHint>
        ) : verified ? (
          <InlineHint kind="success">
            账号目录已验证
            {s.accounts.find((a) => a.wxid === s.wxid)?.nickname ? ` · ${s.accounts.find((a) => a.wxid === s.wxid)?.nickname}` : ''}
          </InlineHint>
        ) : s.wxid ? (
          <InlineHint kind="warning">请点击「验证账号」确认目录与账号匹配，否则无法进入下一步</InlineHint>
        ) : s.accounts.length > 1 ? (
          <InlineHint kind="info">检测到 {s.accounts.length} 个账号，请选择要接入的那一个</InlineHint>
        ) : null}
      </div>
    </Card>
  )
}
