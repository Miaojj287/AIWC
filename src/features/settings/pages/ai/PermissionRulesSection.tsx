/**
 * 权限规则 (设置 › AI 接入): every grant made with 总是允许 — the ones for all chats, then each chat's own — with
 * what it allows and where, a link to the chat, and 撤销 behind a confirmation. The permission menu's 权限规则… and
 * the toast after a grant both land here.
 */
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AgentGrant } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Card, ConfirmDialog, EmptyState, toast } from '@/kit'
import { runCommand } from '@/app/commands'
import { grantLabel } from '@/platform/grants'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import { PagePlaceholder, SRow, Section } from '../../pageKit'

const SECTION_ID = 'ai.permissions'

const grantId = (g: AgentGrant): string => (g.scope === 'global' ? `global:${g.key}` : `${g.threadId}:${g.key}`)

export function PermissionRulesSection() {
  const t = useT()
  const grants = useInvoke('privacy:listGrants', undefined, [])
  useBridgeEvent('privacy:grantsChanged', () => grants.reload())
  const [pending, setPending] = useState<AgentGrant | undefined>()
  const [busy, setBusy] = useState(false)

  const revoke = async (grant: AgentGrant) => {
    setBusy(true)
    try {
      await invoke('privacy:revokeGrant', {
        scope: grant.scope,
        key: grant.key,
        ...(grant.scope === 'thread' ? { threadId: grant.threadId } : {}),
      })
      toast.success(t('settings.ai.permissions.revoked'))
      setPending(undefined)
      grants.reload()
    } catch (e) {
      toast.error(t('settings.ai.permissions.revokeFailed'), { detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const body = (() => {
    if (grants.error)
      return (
        <EmptyState
          variant="error"
          compact
          bordered
          title={t('settings.ai.permissions.loadFailed')}
          description={errorMessage(grants.error)}
          action={{ label: t('settings.ai.permissions.retry'), onClick: grants.reload }}
        />
      )
    if (!grants.data) return <PagePlaceholder rows={2} />
    if (grants.data.length === 0)
      return (
        <EmptyState
          compact
          bordered
          icon={ShieldCheck}
          title={t('settings.ai.permissions.empty')}
          description={t('settings.ai.permissions.emptyDescription')}
        />
      )
    return (
      <Card variant="rows">
        {grants.data.map((grant) => (
          <SRow
            key={grantId(grant)}
            id={`${SECTION_ID}.${grantId(grant)}`}
            title={<span className="min-w-0 truncate">{grantLabel(grant.key)}</span>}
            description={
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="min-w-0 truncate font-mono" title={grant.key}>
                  {grant.key}
                </span>
                <span className="min-w-0 truncate">
                  {grant.scope === 'global'
                    ? t('settings.ai.permissions.scopeGlobal')
                    : grant.phone
                      ? t('settings.ai.permissions.scopePhone')
                      : t('settings.ai.permissions.scopeThread', {
                          title: grant.threadTitle || t('settings.ai.permissions.untitledThread'),
                        })}
                </span>
              </span>
            }
          >
            <div className="flex shrink-0 items-center gap-1">
              {/* the phone thread is driven from the phone, not opened in the panel */}
              {grant.scope === 'thread' && !grant.phone ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => runCommand('agent.openThread', { threadId: grant.threadId })}
                >
                  {t('settings.ai.permissions.openThread')}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setPending(grant)}>
                {t('settings.ai.permissions.revoke')}
              </Button>
            </div>
          </SRow>
        ))}
      </Card>
    )
  })()

  return (
    <Section title={t('settings.ai.permissions.title')} id={SECTION_ID} help={t('settings.ai.permissions.help')}>
      {body}
      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(open) => !open && !busy && setPending(undefined)}
        icon={ShieldCheck}
        title={t('settings.ai.permissions.revokeTitle')}
        description={pending ? t('settings.ai.permissions.revokeDescription', { target: grantLabel(pending.key) }) : ''}
        confirmLabel={t('settings.ai.permissions.revoke')}
        loading={busy}
        onConfirm={() => pending && void revoke(pending)}
      />
    </Section>
  )
}
