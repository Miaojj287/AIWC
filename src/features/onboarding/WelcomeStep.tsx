/**
 * 欢迎页: wordmark → title → one-line subtitle → language → agreement → 开始. Nothing else: the capability cards and
 * the notes now live in the agreement itself (dialogs.tsx), so the first screen is calm and has one decision.
 */
import { ArrowRight } from 'lucide-react'
import { useState, type ReactNode, type Ref } from 'react'
import { useT } from '@/i18n'
import { Button, Checkbox } from '@/kit'
import { AgreementDialog } from './dialogs'
import { useWizardStore } from './wizardStore'

export interface WelcomeStepProps {
  onNext(): void
  /** The page heading; the wizard moves focus here when this step opens again. */
  headingRef?: Ref<HTMLHeadingElement>
  /** The wizard's language control, shown in the middle of the page instead of the top bar. */
  languageSwitch?: ReactNode
}

export function WelcomeStep({ onNext, headingRef, languageSwitch }: WelcomeStepProps) {
  const t = useT()
  const agreed = useWizardStore((s) => s.agreed)
  const setAgreed = useWizardStore((s) => s.setAgreed)
  const [agreementOpen, setAgreementOpen] = useState(false)

  return (
    <div className="m-auto flex w-full max-w-[440px] flex-col items-center gap-10 px-6 py-12 [@media(max-height:760px)]:gap-7">
      <div className="flex flex-col items-center gap-6">
        <span aria-hidden className="select-none font-latin text-wordmark font-semibold tracking-[0.18em] text-fg">
          A<span className="text-accent">I</span>WC
        </span>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-wizard font-medium leading-8 text-fg">
            {t('onboarding.welcome.title')}
          </h1>
          <p className="text-body text-fg-3">{t('onboarding.welcome.subtitle')}</p>
        </div>
      </div>

      {languageSwitch}

      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-wrap items-center justify-center gap-x-1">
          <Checkbox
            checked={agreed}
            onCheckedChange={(c) => setAgreed(c === true)}
            label={t('onboarding.welcome.agreeLabel')}
            className="shrink-0 items-center whitespace-nowrap"
          />
          <Button variant="link" size="sm" onClick={() => setAgreementOpen(true)} className="-ml-1 px-1">
            {t('onboarding.welcome.agreementLink')}
          </Button>
        </div>
        <Button
          trailingIcon={ArrowRight}
          disabled={!agreed}
          disabledReason={t('onboarding.welcome.agreeFirst')}
          onClick={onNext}
          className="h-9 min-w-[160px] px-6"
        >
          {t('onboarding.welcome.start')}
        </Button>
      </div>

      <AgreementDialog open={agreementOpen} onOpenChange={setAgreementOpen} onAgree={() => setAgreed(true)} />
    </div>
  )
}
