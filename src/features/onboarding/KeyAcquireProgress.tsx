import { RefreshCw, ScanSearch, Settings } from 'lucide-react'
import { useT } from '@/i18n'
import { Button, TaskProgress } from '@/kit'
import { openUrl } from '@/platform/openExternal'
import { DEVELOPER_TOOLS_SETTINGS_URL, keyAcquireView, useClock } from '@/platform/wechatKeys'
import { useWizardStore } from './wizardStore'

/** Scoped progress and retry actions for an explicitly initiated connection or image recovery. */
export function KeyAcquireProgress({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  const acquiring = useWizardStore((s) => s.acquiring)
  const failed = useWizardStore((s) => s.acquireFailed)
  const steps = useWizardStore((s) => s.acquireSteps)
  const startedAt = useWizardStore((s) => s.acquireStartedAt)
  const cancelAcquire = useWizardStore((s) => s.cancelAcquire)
  const dismiss = useWizardStore((s) => s.dismissAcquireResult)
  const acquire = useWizardStore((s) => s.acquire)
  const scope = useWizardStore((s) => s.acquireScope)
  const now = useClock(acquiring)
  if (!acquiring && !failed) return null
  const view = keyAcquireView(steps, { running: acquiring, startedAt, now })
  return (
    <TaskProgress
      {...view}
      onCancel={cancelAcquire}
      actions={
        view.state === 'failed' ? (
          <>
            <Button
              variant="outline"
              size="sm"
              icon={RefreshCw}
              onClick={() => (scope === 'database' && onRetry ? onRetry() : void acquire('auto', scope))}
            >
              {t('common.retry')}
            </Button>
            {view.needsSettings ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Settings}
                onClick={() => void openUrl(DEVELOPER_TOOLS_SETTINGS_URL)}
              >
                {t('app.keyAcquire.openSettings')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" icon={ScanSearch} onClick={() => void acquire('memory_scan', scope)}>
                {t('onboarding.keys.memoryScan')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t('common.close')}
            </Button>
          </>
        ) : undefined
      }
    />
  )
}
