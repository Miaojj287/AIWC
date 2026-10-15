import { ChevronDown, ChevronRight, Image, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { Button, Card, FieldLabel, InlineHint } from '@/kit'
import { classifyDatabaseCoverage } from '@/platform/databaseCoverage'
import { KEY_KINDS, hasKey } from './gating'
import { KeyAcquireProgress } from './KeyAcquireProgress'
import { KeyRow } from './KeyRow'
import { useWizardStore } from './wizardStore'

/** Connection capabilities first; manual secrets and optional image recovery stay secondary. */
export function KeysCard({ onConnect, returning = false }: { onConnect?: () => void; returning?: boolean }) {
  const t = useT()
  const [advanced, setAdvanced] = useState(false)
  const keys = useWizardStore((s) => s.keys)
  const credentials = useWizardStore((s) => s.credentials)
  const credentialsLoading = useWizardStore((s) => s.credentialsLoading)
  const hydrated = useWizardStore((s) => s.hydrated)
  const accountsLoading = useWizardStore((s) => s.accountsLoading)
  const detecting = useWizardStore((s) => s.detecting)
  const credentialsError = useWizardStore((s) => s.credentialsError)
  const acquiring = useWizardStore((s) => s.acquiring)
  const acquire = useWizardStore((s) => s.acquire)
  const wxid = useWizardStore((s) => s.wxid)
  const dbRoot = useWizardStore((s) => s.dbRoot)
  const hasDatabase = hasKey(keys.db_key)
  const checking = !hydrated || credentialsLoading || accountsLoading || detecting
  const canAcquire = Boolean(wxid && dbRoot) && !acquiring && !checking
  const cachedEntry = returning && credentials?.database
  const imagesReady = hasKey(keys.image_xor) && hasKey(keys.image_aes)
  const coverage = classifyDatabaseCoverage(credentials)
  const hasUnavailableChat = coverage === 'chat' || coverage === 'other'

  return (
    <Card className="flex flex-col gap-3">
      <FieldLabel
        icon={KeyRound}
        label={t('onboarding.connection.label')}
        help={t('onboarding.connection.help')}
        status={
          checking
            ? { kind: 'info', text: t('onboarding.connection.checking') }
            : hasDatabase
              ? {
                  kind: hasUnavailableChat ? 'warning' : 'success',
                  text: t(hasUnavailableChat ? 'onboarding.connection.partialReady' : 'onboarding.connection.ready'),
                }
              : undefined
        }
      />
      {credentialsError ? <InlineHint kind="error">{credentialsError}</InlineHint> : null}
      {checking ? null : hasDatabase ? (
        <InlineHint kind={hasUnavailableChat ? 'warning' : 'success'}>
          {credentials && (credentials.missing.length || hasUnavailableChat)
            ? t(
                coverage === 'auxiliary'
                  ? 'onboarding.connection.auxiliary'
                  : coverage === 'chat'
                    ? 'onboarding.connection.partial'
                    : 'onboarding.connection.partialDatabase',
                { matched: credentials.matched, total: credentials.total },
              )
            : cachedEntry
              ? t('onboarding.connection.cachedEntry')
              : t('onboarding.connection.reuse')}
        </InlineHint>
      ) : (
        <span className="text-caption text-fg-3">{t('onboarding.connection.startHint')}</span>
      )}
      {!checking && cachedEntry && credentials.missing.length ? (
        <span className="text-caption text-fg-3">{t('onboarding.connection.cachedEntry')}</span>
      ) : null}
      {credentials?.missing.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-3">{t('onboarding.connection.missing')}</span>
          {credentials.missing.map((path) => (
            <span key={path} className="truncate font-mono text-caption text-fg-2" title={path}>
              {path}
            </span>
          ))}
        </div>
      ) : null}
      {hasDatabase && !imagesReady ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={Image}
            onClick={() => void acquire('memory_scan', 'image')}
            disabled={!canAcquire}
          >
            {t('onboarding.keys.acquireImageKeys')}
          </Button>
          <span className="text-note text-fg-3">{t('onboarding.keys.imageKeysLater')}</span>
        </div>
      ) : null}
      <KeyAcquireProgress onRetry={onConnect} />
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
        <div className="grid grid-cols-2 gap-3">
          {KEY_KINDS.map((kind) => (
            <KeyRow key={`${wxid}:${dbRoot}:${kind}`} kind={kind} state={keys[kind]} wide={kind === 'db_key'} />
          ))}
        </div>
      ) : null}
    </Card>
  )
}
