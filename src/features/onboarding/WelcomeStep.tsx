/**
 * 欢迎页 (Figma 91:417): logo → title 22 → subtitle → three capability Cards → agreement Card → primary
 * button (disabled until agreed) → hint line. The steps bar is rendered by the wizard frame.
 */
import { ArrowRight, Bot, CircleAlert, Lock, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Trans, useT } from '@/i18n'
import { Button, Card, Checkbox, ICON_STROKE, Tooltip, cn } from '@/kit'
import { AgreementDialog } from './dialogs'
import { useWizardStore } from './wizardStore'

/** `title` / `body` are catalog keys. */
const CAPABILITIES = [
  {
    icon: Lock,
    tone: 'bg-ok/15 text-ok',
    title: 'onboarding.welcome.capabilities.local.title',
    body: 'onboarding.welcome.capabilities.local.body',
  },
  {
    icon: Sparkles,
    tone: 'bg-accent-15 text-accent',
    title: 'onboarding.welcome.capabilities.agent.title',
    body: 'onboarding.welcome.capabilities.agent.body',
  },
  {
    icon: Bot,
    tone: 'bg-info/15 text-info',
    title: 'onboarding.welcome.capabilities.automation.title',
    body: 'onboarding.welcome.capabilities.automation.body',
  },
] as const

const NOTES = [
  {
    icon: ShieldCheck,
    tone: 'text-ok',
    title: 'onboarding.welcome.notes.local.title',
    body: 'onboarding.welcome.notes.local.body',
  },
  {
    icon: UserRound,
    tone: 'text-info',
    title: 'onboarding.welcome.notes.scope.title',
    body: 'onboarding.welcome.notes.scope.body',
  },
  {
    icon: CircleAlert,
    tone: 'text-fg-3',
    title: 'onboarding.welcome.notes.disclaimer.title',
    body: 'onboarding.welcome.notes.disclaimer.body',
  },
] as const

export function WelcomeStep({ onNext }: { onNext(): void }) {
  const t = useT()
  const agreed = useWizardStore((s) => s.agreed)
  const setAgreed = useWizardStore((s) => s.setAgreed)
  const [agreementOpen, setAgreementOpen] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col items-center gap-6 px-6 pb-10 pt-12">
      <div aria-hidden className="flex h-[88px] items-center justify-center">
        <span className="select-none font-latin text-[56px] font-semibold tracking-[0.18em] text-fg">
          A<span className="text-accent">I</span>WC
        </span>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-wizard font-medium leading-8 text-fg">{t('onboarding.welcome.title')}</h1>
        <p className="text-body text-fg-3">{t('onboarding.welcome.subtitle')}</p>
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        {CAPABILITIES.map((c) => (
          <Card key={c.title} className="flex flex-col gap-3">
            <span className={cn('flex size-8 items-center justify-center rounded-item', c.tone)}>
              <c.icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <div className="text-body font-medium text-fg">{t(c.title)}</div>
              <div className="text-caption leading-[18px] text-fg-3">{t(c.body)}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="flex w-full flex-col gap-3">
        <div className="flex items-center gap-1 border-b border-line-6 pb-3">
          <Checkbox
            checked={agreed}
            onCheckedChange={(c) => setAgreed(c === true)}
            label={t('onboarding.welcome.agreeLabel')}
            className="items-center"
          />
          <Button variant="link" size="sm" onClick={() => setAgreementOpen(true)} className="-ml-1 px-1">
            {t('onboarding.welcome.agreementLink')}
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {NOTES.map((n) => (
            <li key={n.title} className="flex items-start gap-2 text-caption leading-[18px]">
              <n.icon size={13} strokeWidth={ICON_STROKE} aria-hidden className={cn('mt-0.5 shrink-0', n.tone)} />
              <span className="text-fg-3">
                <Trans
                  k="onboarding.welcome.note"
                  params={{ title: <span className="font-medium text-fg">{t(n.title)}</span>, body: t(n.body) }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col items-center gap-3">
        <Tooltip content={t('onboarding.welcome.agreeFirst')} disabled={agreed}>
          <span className="inline-flex">
            <Button trailingIcon={ArrowRight} disabled={!agreed} onClick={onNext} className="h-9 px-6">
              {t('onboarding.welcome.start')}
            </Button>
          </span>
        </Tooltip>
        <span className="text-note text-fg-3">{t('onboarding.welcome.footnote')}</span>
      </div>

      <AgreementDialog open={agreementOpen} onOpenChange={setAgreementOpen} onAgree={() => setAgreed(true)} />
    </div>
  )
}
