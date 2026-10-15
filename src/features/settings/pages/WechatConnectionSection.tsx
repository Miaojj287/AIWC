import { ChevronDown, ChevronRight, Image, Link } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppConfig, KeyAcquireStep } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, InlineHint, toast } from '@/kit'
import { useInvoke } from '@/platform/hooks'
import { classifyDatabaseCoverage } from '@/platform/databaseCoverage'
import { secretRefFor, type KeyKind } from '../accountModel'
import { errorMessage } from '../hooks'
import { SRow, Section } from '../pageKit'
import { AcquireKeysButton, InlineKeyAcquire, SecretField } from './AccountKeys'
import { DatabaseCredentialStatus, SavedDatabaseCredentials } from './DatabaseCredentialStatus'

interface WechatConnectionSectionProps {
  account: AppConfig['account']
  version: number
  onSaved(): void
  onConnect(): Promise<void>
}

/** Show connection capabilities first, with legacy manual keys behind an explicit disclosure. */
export function WechatConnectionSection({ account, version, onSaved, onConnect }: WechatConnectionSectionProps) {
  const t = useT()
  const [advanced, setAdvanced] = useState(false)
  const [manualTarget, setManualTarget] = useState<KeyKind | null>(null)
  const [acquire, setAcquire] = useState<'database' | 'image' | null>(null)
  const [connecting, setConnecting] = useState(false)
  const credentials = useInvoke(
    'substrate:credentialStatus',
    { wxid: account.wxid ?? '', dbRoot: account.dbRoot ?? '' },
    [account.credentialRevision, version],
    { enabled: Boolean(account.wxid && account.dbRoot) },
  )
  const canConnect = Boolean(account.wxid && account.dbRoot)
  const hasDatabase = Boolean(credentials.data?.database)
  const coverage = classifyDatabaseCoverage(credentials.data)
  const hasUnavailableChat = coverage === 'chat' || coverage === 'other'
  const imagesReady = Boolean(credentials.data?.imageXor && credentials.data.imageAes)
  const isBusy = connecting || acquire !== null

  useEffect(() => {
    if (advanced && manualTarget) document.getElementById(`account-key-${manualTarget}`)?.focus()
  }, [advanced, manualTarget])

  const connect = async () => {
    setConnecting(true)
    try {
      await onConnect()
    } catch (error) {
      toast.error(t('settings.account.verify.connectFailed'), { detail: errorMessage(error) })
    } finally {
      setConnecting(false)
    }
  }
  const onAcquired = (steps: KeyAcquireStep[]) => {
    onSaved()
    if (acquire === 'database' && steps.some((step) => step.id === 'verify' && step.status === 'done')) void connect()
  }
  const showManual = (kind: KeyKind) => {
    setManualTarget(kind)
    setAdvanced(true)
  }

  return (
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
              {credentials.error ? <InlineHint kind="error">{t('onboarding.connect.statusFailed')}</InlineHint> : null}
              {acquire === 'database' ? (
                <InlineKeyAcquire
                  wxid={account.wxid}
                  dbRoot={account.dbRoot}
                  scope="database"
                  onFinished={onAcquired}
                  onManual={showManual}
                  onClose={() => setAcquire(null)}
                />
              ) : null}
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {credentials.loading ? (
              <span className="text-caption text-fg-3">{t('onboarding.connection.checking')}</span>
            ) : hasDatabase ? (
              <Badge tone={hasUnavailableChat ? 'warn' : 'ok'}>
                {t(hasUnavailableChat ? 'onboarding.connection.partialReady' : 'onboarding.connection.ready')}
              </Badge>
            ) : (
              <span className="text-caption text-fg-3">{t('onboarding.connection.startHint')}</span>
            )}
            <Button
              variant={hasDatabase ? 'outline' : 'primary'}
              icon={Link}
              loading={connecting}
              disabled={!canConnect || credentials.loading || acquire !== null}
              disabledReason={!canConnect ? t('settings.account.acquire.selectFirst') : undefined}
              onClick={() => {
                if (hasDatabase) void connect()
                else setAcquire('database')
              }}
            >
              {t('settings.account.dbKey.acquire')}
            </Button>
          </div>
        </SRow>
        <SRow
          id="account.imageKeys"
          title={t('settings.account.imageKeys.title')}
          description={t('onboarding.keys.imageKeysLater')}
          help={t('settings.account.imageKeys.help')}
          stacked
          footer={
            acquire === 'image' ? (
              <InlineKeyAcquire
                wxid={account.wxid}
                dbRoot={account.dbRoot}
                scope="image"
                onFinished={onAcquired}
                onManual={showManual}
                onClose={() => setAcquire(null)}
              />
            ) : null
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {imagesReady ? <Badge tone="ok">{t('settings.account.imageKeys.ready')}</Badge> : null}
            <AcquireKeysButton
              secretRef={secretRefFor(account, 'image_aes')}
              version={version}
              available={imagesReady}
              icon={Image}
              disabled={!canConnect || isBusy || credentials.loading}
              disabledReason={!canConnect ? t('settings.account.acquire.selectFirst') : undefined}
              onClick={() => setAcquire('image')}
            >
              {t('settings.account.imageKeys.acquire')}
            </AcquireKeysButton>
          </div>
        </SRow>
      </Card>
      <Button
        variant="ghost"
        size="sm"
        icon={advanced ? ChevronDown : ChevronRight}
        aria-expanded={advanced}
        onClick={() => setAdvanced(!advanced)}
        className="self-start"
      >
        {t('onboarding.connection.advanced')}
      </Button>
      {advanced ? (
        <Card className="flex flex-wrap items-end gap-3">
          {account.dbCredentialsRef ? (
            <SavedDatabaseCredentials />
          ) : (
            <LabeledSecret account={account} kind="db_key" version={version} onSaved={onSaved} />
          )}
          <LabeledSecret account={account} kind="image_xor" version={version} onSaved={onSaved} />
          <LabeledSecret account={account} kind="image_aes" version={version} onSaved={onSaved} />
        </Card>
      ) : null}
    </Section>
  )
}

function LabeledSecret({
  account,
  kind,
  version,
  onSaved,
}: {
  account: AppConfig['account']
  kind: KeyKind
  version: number
  onSaved(): void
}) {
  const t = useT()
  const label = t(
    kind === 'db_key'
      ? 'settings.account.dbKey.fieldLabel'
      : kind === 'image_xor'
        ? 'settings.account.imageKeys.xor'
        : 'settings.account.imageKeys.aes',
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-micro text-fg-3">{label}</span>
      <SecretField
        kind={kind}
        secretRef={secretRefFor(account, kind)}
        version={version}
        label={label}
        onSaved={onSaved}
      />
    </div>
  )
}
