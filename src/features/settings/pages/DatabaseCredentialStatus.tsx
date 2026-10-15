import type { WechatCredentialStatus } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { InlineHint, Input } from '@/kit'
import { classifyDatabaseCoverage } from '@/platform/databaseCoverage'

/** Display safe per-file availability without exposing a private database credential bundle. */
export function DatabaseCredentialStatus({ credentials }: { credentials?: WechatCredentialStatus }) {
  const t = useT()
  if (!credentials) return null
  const coverage = classifyDatabaseCoverage(credentials)
  const hasUnavailableChat = coverage === 'chat' || coverage === 'other'
  return (
    <div className="flex flex-col gap-2">
      {credentials.database ? (
        <InlineHint kind={hasUnavailableChat ? 'warning' : 'success'}>
          {credentials.missing.length || hasUnavailableChat
            ? t(
                coverage === 'auxiliary'
                  ? 'onboarding.connection.auxiliary'
                  : coverage === 'chat'
                    ? 'onboarding.connection.partial'
                    : 'onboarding.connection.partialDatabase',
                { matched: credentials.matched, total: credentials.total },
              )
            : t('onboarding.connection.reuse')}
        </InlineHint>
      ) : null}
      {credentials.missing.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-3">{t('onboarding.connection.missing')}</span>
          {credentials.missing.map((path) => (
            <span key={path} className="truncate font-mono text-caption text-fg-2" title={path}>
              {path}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A masked saved bundle has no renderer reveal or copy action. */
export function SavedDatabaseCredentials() {
  const t = useT()
  return (
    <Input
      mono
      size="sm"
      readOnly
      revealable={false}
      value="••••••••••••••••"
      aria-label={t('onboarding.connection.savedCredentials')}
      wrapperClassName="min-w-[200px] flex-1"
    />
  )
}
