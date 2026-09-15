/**
 * Wizard dialogs: 用户协议与隐私政策 (scrollable), 需要「完全磁盘访问」权限 guidance, 无法打开数据库 failure,
 * 退出设置向导 confirm. Figma 155:415.
 */
import { CircleAlert, KeyRound, Lock, Settings, ShieldCheck } from 'lucide-react'
import { useT, type MessageKey } from '@/i18n'
import { Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/kit'
import { openUrl } from '@/platform/openExternal'

/** Catalog keys: section heading + paragraphs. */
const AGREEMENT_SECTIONS: Array<{ title: MessageKey; body: MessageKey[] }> = [
  {
    title: 'onboarding.agreement.sections.local.title',
    body: ['onboarding.agreement.sections.local.p1', 'onboarding.agreement.sections.local.p2'],
  },
  {
    title: 'onboarding.agreement.sections.scope.title',
    body: ['onboarding.agreement.sections.scope.p1', 'onboarding.agreement.sections.scope.p2'],
  },
  {
    title: 'onboarding.agreement.sections.keys.title',
    body: ['onboarding.agreement.sections.keys.p1', 'onboarding.agreement.sections.keys.p2'],
  },
  {
    title: 'onboarding.agreement.sections.disclaimer.title',
    body: ['onboarding.agreement.sections.disclaimer.p1', 'onboarding.agreement.sections.disclaimer.p2'],
  },
]

export function AgreementDialog({
  open,
  onOpenChange,
  onAgree,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onAgree(): void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader
          icon={ShieldCheck}
          tone="ok"
          title={t('onboarding.agreement.title')}
          description={t('onboarding.agreement.description')}
        />
        <DialogBody className="max-h-[52vh] gap-4 pr-1">
          {AGREEMENT_SECTIONS.map((s) => (
            <section key={s.title} className="flex flex-col gap-1.5">
              <h3 className="text-body font-medium text-fg">{t(s.title)}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="text-caption leading-[18px] text-fg-2">
                  {t(p)}
                </p>
              ))}
            </section>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            onClick={() => {
              onAgree()
              onOpenChange(false)
            }}
          >
            {t('onboarding.agreement.agree')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

export function PermissionDialog({
  open,
  onOpenChange,
  onRetry,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onRetry(): void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={Lock}
          tone="danger"
          title={t('onboarding.permission.title')}
          description={t('onboarding.permission.description')}
        />
        <DialogBody>
          <ol className="flex flex-col gap-1.5 text-caption text-fg-2">
            {(
              [
                'onboarding.permission.stepOpenSettings',
                'onboarding.permission.stepEnable',
                'onboarding.permission.stepRetry',
              ] as const
            ).map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="flex size-4 items-center justify-center rounded-chip border border-(--line-25) font-latin text-micro text-fg-3">
                  {i + 1}
                </span>
                {t(step)}
              </li>
            ))}
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('onboarding.permission.later')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              onRetry()
            }}
          >
            {t('common.retry')}
          </Button>
          <Button icon={Settings} onClick={() => void openUrl(SETTINGS_URL)}>
            {t('onboarding.permission.openSettings')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectFailDialog({
  error,
  onOpenChange,
  onReacquire,
}: {
  error: string | undefined
  onOpenChange(open: boolean): void
  onReacquire(): void
}) {
  const t = useT()
  return (
    <Dialog open={error !== undefined} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={CircleAlert}
          tone="danger"
          title={t('onboarding.connectFail.title')}
          description={t('onboarding.connectFail.description', { error: error ?? '' })}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('onboarding.connectFail.back')}
          </Button>
          <Button
            icon={KeyRound}
            onClick={() => {
              onOpenChange(false)
              onReacquire()
            }}
          >
            {t('onboarding.connectFail.reacquire')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ExitDialog({
  open,
  onOpenChange,
  onExit,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onExit(): void
}) {
  const t = useT()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={CircleAlert}
      tone="warn"
      title={t('onboarding.exit.title')}
      description={t('onboarding.exit.description')}
      cancelLabel={t('onboarding.exit.continue')}
      confirmLabel={t('onboarding.exit.confirm')}
      onConfirm={onExit}
    />
  )
}
