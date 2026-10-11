/**
 * 连接微信 + 解锁数据 (Figma 135:415, merged page): two sections with the account and keys cards and the
 * 上一步 / 下一步 footer whose disabled 下一步 explains the gate.
 * On a later launch (`returning`) the same page opens prefilled under a 欢迎回来 header with the account's avatar and
 * nickname, and the footer is a single 进入.
 */
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { Ref } from 'react'
import { useT } from '@/i18n'
import { Avatar, Button } from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { AccountCard } from './AccountCard'
import { KeysCard } from './KeysCard'
import { PermissionDialog } from './dialogs'
import { nextStepGate } from './gating'
import { selectDbKeyPresent, useWizardStore } from './wizardStore'

export interface ConnectStepProps {
  onBack(): void
  onNext(): void
  stepsBar: React.ReactNode
  /** The page heading; the wizard moves focus here when this step opens. */
  headingRef?: Ref<HTMLHeadingElement>
  /** A later launch: identity header, no 上一步, 进入 instead of 下一步. */
  returning?: boolean
}

/** 欢迎回来 + the saved account, with its real avatar and nickname once the database is open. */
function ReturningHeader({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  const t = useT()
  const wxid = useWizardStore((s) => s.wxid)
  const account = useWizardStore((s) => s.accounts.find((a) => a.wxid === s.wxid))
  const name = account?.nickname
  return (
    <header className="flex items-center gap-4">
      <Avatar id={wxid || 'aiwc'} name={name || wxid || 'AIWC'} src={toMediaUrl(account?.avatarPath)} size={56} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 ref={headingRef} tabIndex={-1} className="truncate text-wizard font-medium leading-8 text-fg">
          {name ? t('onboarding.connect.welcomeBackName', { name }) : t('onboarding.connect.welcomeBack')}
        </h1>
        {wxid ? (
          <span className="truncate font-mono text-caption text-fg-3" title={wxid}>
            {wxid}
          </span>
        ) : null}
      </div>
    </header>
  )
}

export function ConnectStep({ onBack, onNext, stepsBar, headingRef, returning = false }: ConnectStepProps) {
  const t = useT()
  const dbRoot = useWizardStore((s) => s.dbRoot)
  const wxid = useWizardStore((s) => s.wxid)
  const verified = useWizardStore((s) => s.verifyState === 'verified')
  const dbKeyPresent = useWizardStore(selectDbKeyPresent)
  const testing = useWizardStore((s) => s.testing)
  const permissionDialog = useWizardStore((s) => s.permissionDialog)
  const dismissPermissionDialog = useWizardStore((s) => s.dismissPermissionDialog)
  const acquire = useWizardStore((s) => s.acquire)

  const gate = nextStepGate({ dbRoot, wxid, verified, dbKeyPresent })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-8 pb-6 pt-8">
          {returning ? <ReturningHeader headingRef={headingRef} /> : null}
          <section className="flex flex-col gap-3">
            {returning ? (
              <h2 className="text-body font-medium text-fg-2">{t('onboarding.connect.pathTitle')}</h2>
            ) : (
              <h1 ref={headingRef} tabIndex={-1} className="text-title font-medium leading-7 text-fg">
                {t('onboarding.connect.pathTitle')}
              </h1>
            )}
            <AccountCard />
          </section>
          <section className="flex flex-col gap-3">
            {/* Same tracking as the h1 above, so the two section titles still read as a pair. */}
            <h2
              className={
                returning
                  ? 'text-body font-medium text-fg-2'
                  : 'text-title font-medium leading-7 tracking-(--tracking-heading) text-fg'
              }
            >
              {t('onboarding.connect.keysTitle')}
            </h2>
            <KeysCard />
          </section>
        </div>
      </div>
      <footer className="flex h-[64px] shrink-0 items-center gap-4 border-t border-line-6 px-8">
        {returning ? null : (
          <Button variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={testing}>
            {t('onboarding.connect.back')}
          </Button>
        )}
        <div className="flex flex-1 justify-center">{stepsBar}</div>
        <Button
          trailingIcon={ArrowRight}
          disabled={!gate.ok}
          disabledReason={gate.reason}
          loading={testing}
          onClick={onNext}
        >
          {testing ? t('onboarding.connect.testing') : returning ? t('onboarding.connect.enter') : t('common.next')}
        </Button>
      </footer>

      <PermissionDialog
        open={permissionDialog}
        onOpenChange={(o) => !o && dismissPermissionDialog()}
        onRetry={() => void acquire('memory_scan')}
      />
    </div>
  )
}
