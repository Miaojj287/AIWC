/**
 * Card ① 微信与账号 (Figma 135:415 上半 / 155:415 ①): database path (自动获取 / 浏览), optional cache dir
 * (恢复默认), account Select with verified badges + 验证 / 重新扫描.
 */
import { CircleCheck, ExternalLink, Folder, FolderOpen, RefreshCw, RotateCcw, Sparkles, UserRound } from 'lucide-react'
import { useT } from '@/i18n'
import { Avatar, Badge, Button, Card, FieldLabel, InlineHint, Input, Select, type SelectOption } from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { openLocalPath } from '@/platform/openExternal'
import { useWizardStore } from './wizardStore'

export function AccountCard() {
  const t = useT()
  const s = useWizardStore()

  const pathStatus = s.detecting
    ? undefined
    : s.dbRootSource === 'auto'
      ? { kind: 'success' as const, text: t('onboarding.account.pathAuto') }
      : s.dbRootSource === 'cached'
        ? { kind: 'success' as const, text: t('onboarding.account.pathCached') }
        : s.dbRootSource === 'manual'
          ? { kind: 'info' as const, text: t('onboarding.account.pathManual') }
          : undefined

  const accountOptions: SelectOption[] = s.accounts.map((a) => ({
    value: a.wxid,
    label: a.nickname || t('onboarding.account.unnamedAccount'),
    description: a.wxid,
    leading: (
      <Avatar
        id={a.wxid}
        name={a.nickname || t('onboarding.account.unnamedAvatar')}
        src={toMediaUrl(a.avatarPath)}
        size={28}
      />
    ),
    badge: a.verified ? (
      <Badge tone="ok">{t('onboarding.account.verified')}</Badge>
    ) : (
      <Badge tone="warn">{t('onboarding.account.unverified')}</Badge>
    ),
  }))

  const verified = s.verifyState === 'verified'

  return (
    <Card className="flex flex-col gap-4">
      {/* 微信数据库路径 */}
      <div className="flex flex-col gap-2">
        <FieldLabel
          icon={Folder}
          label={t('onboarding.account.pathLabel')}
          help={t('onboarding.account.pathHelp')}
          hint={t('onboarding.account.pathHint')}
          status={pathStatus}
          htmlFor="ob-dbroot"
        />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Input
            id="ob-dbroot"
            mono
            value={s.detecting ? '' : s.dbRoot}
            placeholder={
              s.detecting ? t('onboarding.account.detectingPlaceholder') : t('onboarding.account.notFoundPlaceholder')
            }
            onChange={(e) => s.setDbRoot(e.target.value)}
            onBlur={() => void s.loadAccounts()}
            disabled={s.detecting}
            error={Boolean(s.dbRootError)}
            wrapperClassName="flex-1"
            aria-label={t('onboarding.account.pathLabel')}
          />
          <Button variant="ghost" icon={FolderOpen} onClick={() => void s.browse()} disabled={s.detecting}>
            {t('onboarding.account.browse')}
          </Button>
          <Button icon={s.dbRootError ? RefreshCw : Sparkles} loading={s.detecting} onClick={() => void s.detect()}>
            {s.detecting
              ? t('onboarding.account.detecting')
              : s.dbRootError
                ? t('common.retry')
                : t('onboarding.account.detect')}
          </Button>
        </div>
        {s.dbRootError ? (
          <InlineHint kind="error">{s.dbRootError}</InlineHint>
        ) : s.detecting ? (
          <InlineHint kind="info">{t('onboarding.account.readingLocation')}</InlineHint>
        ) : s.dbRoot ? (
          <div className="flex items-center gap-3">
            {s.detectedVersion ? (
              <span className="text-note text-fg-3">
                {t('onboarding.account.wechatVersion', { version: s.detectedVersion })}
              </span>
            ) : null}
            <Button
              variant="link"
              size="sm"
              trailingIcon={ExternalLink}
              onClick={() => void openLocalPath(s.dbRoot, t('onboarding.account.dataFolder'))}
              className="-ml-2"
            >
              {t('onboarding.account.openFolder')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* 缓存目录 */}
      <div className="flex flex-col gap-2">
        <FieldLabel
          icon={Folder}
          label={t('onboarding.account.cacheLabel')}
          help={t('onboarding.account.cacheHelp')}
          hint={t('onboarding.account.cacheHint')}
          htmlFor="ob-cache"
        />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Input
            id="ob-cache"
            mono
            value={s.cacheDir}
            placeholder={
              s.defaultCacheDir
                ? t('onboarding.account.cacheDefault', { path: s.defaultCacheDir })
                : t('onboarding.account.cacheDefaultAppData')
            }
            onChange={(e) => s.setCacheDir(e.target.value)}
            wrapperClassName="flex-1"
            aria-label={t('onboarding.account.cacheLabel')}
          />
          <Button variant="ghost" icon={FolderOpen} onClick={() => void s.browseCache()}>
            {t('onboarding.account.browse')}
          </Button>
          <Button variant="ghost" icon={RotateCcw} onClick={s.resetCacheDir} disabled={!s.cacheDir}>
            {t('onboarding.account.resetCache')}
          </Button>
        </div>
      </div>

      {/* 微信账号 */}
      <div className="flex flex-col gap-2">
        <FieldLabel
          icon={UserRound}
          label={t('onboarding.account.accountLabel')}
          help={t('onboarding.account.accountHelp')}
          hint={
            s.accounts.length === 0 && s.dbRoot && !s.accountsLoading
              ? t('onboarding.account.noAccountsHint')
              : t('onboarding.account.accountsFound', { n: s.accounts.length })
          }
          status={
            verified
              ? { kind: 'success', text: t('onboarding.account.verified') }
              : s.verifyState === 'failed'
                ? { kind: 'error', text: t('onboarding.account.unverified') }
                : s.wxid
                  ? { kind: 'warning', text: t('onboarding.account.unverified') }
                  : undefined
          }
          htmlFor="ob-wxid"
        />
        <div className="flex items-center gap-2 rounded-item border border-line-6 bg-content/60 p-2">
          <Select
            id="ob-wxid"
            options={accountOptions}
            value={s.wxid || null}
            onValueChange={s.selectWxid}
            placeholder={
              s.accountsLoading
                ? t('onboarding.account.scanning')
                : s.dbRoot
                  ? t('onboarding.account.selectAccount')
                  : t('onboarding.account.selectPathFirst')
            }
            disabled={!s.dbRoot || s.accountsLoading}
            fullWidth
            size="lg"
            searchable={s.accounts.length > 6}
            className="h-auto min-h-12 flex-1 py-1.5"
            aria-label={t('onboarding.account.accountAria')}
            renderValue={(o) =>
              o ? (
                <span className="flex min-w-0 items-center gap-2 text-left">
                  {o.leading}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium">{o.label}</span>
                    <span className="truncate font-mono text-micro text-fg-3">{o.value}</span>
                  </span>
                </span>
              ) : undefined
            }
          />
          {verified ? (
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={s.accountsLoading}
              onClick={() => void s.loadAccounts()}
              disabled={!s.dbRoot}
            >
              {t('onboarding.account.rescan')}
            </Button>
          ) : (
            <Button
              icon={CircleCheck}
              loading={s.verifyState === 'verifying'}
              onClick={() => void s.verify()}
              disabled={!s.wxid || !s.dbRoot}
            >
              {t('onboarding.account.verify')}
            </Button>
          )}
        </div>
        {s.accountsError ? (
          <InlineHint kind="error">{s.accountsError}</InlineHint>
        ) : s.verifyState === 'failed' ? (
          <InlineHint kind="error">{s.verifyError ?? t('onboarding.account.verifyMismatch')}</InlineHint>
        ) : verified ? (
          <InlineHint kind="success">
            {t('onboarding.account.accountVerified')}
            {s.accounts.find((a) => a.wxid === s.wxid)?.nickname
              ? ` · ${s.accounts.find((a) => a.wxid === s.wxid)?.nickname}`
              : ''}
          </InlineHint>
        ) : s.wxid ? (
          <InlineHint kind="warning">{t('onboarding.account.verifyToContinue')}</InlineHint>
        ) : s.accounts.length > 1 ? (
          <InlineHint kind="info">{t('onboarding.account.chooseOne', { n: s.accounts.length })}</InlineHint>
        ) : null}
      </div>
    </Card>
  )
}
