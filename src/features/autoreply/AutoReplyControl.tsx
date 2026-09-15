import { useT } from '@/i18n'
import { Button, Card, InlineHint, toast } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'

/** macOS keeps the accessibility grant behind this pane; deep-linking saves a five-click hunt. */
const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/** The halt reason is free text from the gateway / main process (not UI copy); this spots the accessibility-permission one. */
const ACCESSIBILITY_HALT = /辅助功能|accessibility/i

/**
 * Whatever currently stands between an enabled rule and a sent message.
 *
 * There is no global switch to show: the per-chat toggle is the only control, so anything that
 * stops it is a fault worth reporting, not a setting. When nothing is wrong this renders nothing —
 * an empty warning strip would just be another thing to scan past.
 */
export function AutoReplyControl() {
  const t = useT()
  const status = useInvoke('autoreply:status', undefined, [])
  useBridgeEvent('substrate:event', () => status.reload())
  useBridgeEvent('gateway:event', (e) => {
    if (e.type === 'adapter.state' || e.type === 'autoreply.halted') status.reload()
  })

  const resume = async () => {
    try {
      await invoke('autoreply:resume', undefined)
    } catch (e) {
      toast.error(t('autoreply.control.resumeFailed'), { detail: String(e) })
    }
    status.reload()
  }

  const blocked = status.data?.demo ? 'demo' : status.data && status.data.connection !== 'ready' ? 'offline' : undefined
  if (!blocked && !status.data?.halted) return null

  return (
    <Card variant="rows">
      <div className="flex flex-col gap-2 px-4 py-3">
        {blocked === 'demo' ? <InlineHint kind="warning">{t('autoreply.control.demo')}</InlineHint> : null}
        {blocked === 'offline' ? <InlineHint kind="warning">{t('autoreply.control.offline')}</InlineHint> : null}
        {status.data?.halted ? (
          <>
            <InlineHint kind="error">{t('autoreply.control.halted', { reason: status.data.halted })}</InlineHint>
            <div className="flex flex-wrap items-center gap-2">
              {ACCESSIBILITY_HALT.test(status.data.halted) ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void invoke('app:openUrl', { url: ACCESSIBILITY_PANE }).catch(() =>
                      toast.error(t('autoreply.control.openSettingsFailed')),
                    )
                  }
                >
                  {t('autoreply.control.openAccessibility')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void resume()}>
                {t('autoreply.control.resume')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  )
}
