import type { AutoSendPermissions, OsPermissionState } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Badge, Button, Card, InlineHint, SettingRow, toast, type BadgeProps } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { blockingPermissions, openPermissionPane, paneForHalt, type OsPermission } from './autoSendPermissions'

const STATE_TONE: Record<OsPermissionState, NonNullable<BadgeProps['tone']>> = {
  granted: 'ok',
  denied: 'danger',
  stale: 'warn',
  unknown: 'neutral',
  'not-applicable': 'neutral',
}

/**
 * Whatever currently stands between an enabled rule and a sent message.
 *
 * There is no global switch to show: the per-chat toggle is the only control, so anything that
 * stops it is a fault worth reporting, not a setting. When nothing is wrong this renders nothing —
 * an empty warning strip would just be another thing to scan past. On macOS that includes the system
 * permissions keyboard injection needs (辅助功能 / 自动化), including a grant an app update invalidated.
 */
export function AutoReplyControl() {
  const t = useT()
  const status = useInvoke('autoreply:status', undefined, [])
  const permissions = useInvoke('privacy:autoSendPermissions', undefined, [])
  useBridgeEvent('substrate:event', () => status.reload())
  useBridgeEvent('gateway:event', (e) => {
    if (e.type === 'adapter.state' || e.type === 'autoreply.halted') {
      status.reload()
      permissions.reload()
    }
  })

  const resume = async () => {
    try {
      await invoke('autoreply:resume', undefined)
    } catch (e) {
      toast.error(t('autoreply.control.resumeFailed'), { detail: String(e) })
    }
    status.reload()
    permissions.reload()
  }

  const blocked = status.data?.demo ? 'demo' : status.data && status.data.connection !== 'ready' ? 'offline' : undefined
  const missing = blockingPermissions(permissions.data)
  const haltPane = paneForHalt(status.data?.haltCode)
  if (!blocked && !status.data?.halted && missing.length === 0) return null

  return (
    <Card variant="rows">
      <div className="flex flex-col gap-2 px-4 py-3">
        {blocked === 'demo' ? <InlineHint kind="warning">{t('autoreply.control.demo')}</InlineHint> : null}
        {blocked === 'offline' ? <InlineHint kind="warning">{t('autoreply.control.offline')}</InlineHint> : null}
        {status.data?.halted ? (
          <>
            <InlineHint kind="error">{t('autoreply.control.halted', { reason: status.data.halted })}</InlineHint>
            <div className="flex flex-wrap items-center gap-2">
              {haltPane ? (
                <Button variant="outline" onClick={() => openPermissionPane(haltPane)}>
                  {haltPane === 'accessibility'
                    ? t('autoreply.control.openAccessibility')
                    : t('autoreply.control.openAutomation')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void resume()}>
                {t('autoreply.control.resume')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {permissions.data && missing.length > 0 ? (
        <PermissionRows permissions={permissions.data} onRecheck={permissions.reload} />
      ) : null}
    </Card>
  )
}

const ROWS: ReadonlyArray<{ key: OsPermission; title: 'accessibility' | 'automation' }> = [
  { key: 'accessibility', title: 'accessibility' },
  { key: 'automation', title: 'automation' },
]

function PermissionRows({ permissions, onRecheck }: { permissions: AutoSendPermissions; onRecheck: () => void }) {
  const t = useT()
  return (
    <>
      <SettingRow
        title={t('autoreply.permissions.title')}
        description={t('autoreply.permissions.description')}
        className="px-4"
      >
        <Button variant="outline" size="sm" onClick={onRecheck}>
          {t('autoreply.permissions.recheck')}
        </Button>
      </SettingRow>
      {ROWS.map(({ key, title }) => {
        const state = permissions[key]
        const fixable = state === 'denied' || state === 'stale'
        return (
          <SettingRow
            key={key}
            className="px-4"
            title={t(`autoreply.permissions.${title}`)}
            description={
              state === 'stale' ? t('autoreply.permissions.staleHint') : t(`autoreply.permissions.${title}Hint`)
            }
            badge={<Badge tone={STATE_TONE[state]}>{t(`autoreply.permissions.state.${state}`)}</Badge>}
          >
            {fixable ? (
              <Button variant="outline" size="sm" onClick={() => openPermissionPane(key)}>
                {t('autoreply.permissions.openSettings')}
              </Button>
            ) : null}
          </SettingRow>
        )
      })}
    </>
  )
}
