/**
 * OnboardingWizard — the only screen without the four columns (CLAUDE.md §1). Full-window frame with
 * the language switch and exit ×, the page (欢迎 / 连接与解锁) and the steps bar 欢迎 → 连接微信 → 解锁数据 → 完成.
 * The language switch lives here too: settings are out of reach until setup finishes (CLAUDE.md §11).
 * `onDone` fires after a successful connection test; `onExit` (optional) after the exit confirmation.
 */
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { LANGUAGES, LANGUAGE_NAMES, useLanguage, useT } from '@/i18n'
import { IconButton, SegmentedControl, Tooltip, cn, toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'
import { useBridgeEvent } from '@/platform/hooks'
import { hasUsableModel } from '@/platform/modelAvailability'
import { ConnectStep } from './ConnectStep'
import { WelcomeStep } from './WelcomeStep'
import { ConnectFailDialog, ExitDialog } from './dialogs'
import { STEP_LABELS, activeStepIndex } from './gating'
import { useWizardStore } from './wizardStore'

/** What the 接入模型 page needs; the page itself comes from the app root (features do not import each other). */
export interface ModelStepSlotProps {
  onBack(): void
  onFinish(): void
  stepsBar: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
}

export interface OnboardingWizardProps {
  /** The wizard is done (connection test passed, model connected or skipped): persist `onboarding.completed`. */
  onDone(): void
  /** 接入模型 page after the WeChat connection; without it (tests) the wizard ends after the connection test. */
  modelStep?: (props: ModelStepSlotProps) => ReactNode
  /** The user confirmed leaving the wizard; entered values are already mirrored into AppConfig. */
  onExit?(): void
  /**
   * Connection status on every later launch; no model step or exit action.
   */
  returning?: boolean
}

/** The UI language, by native names so the right one is recognisable whatever the current language (CLAUDE.md §11). */
function LanguageSwitch({ size = 'default' }: { size?: 'default' | 'sm' }) {
  const t = useT()
  const language = useLanguage()
  return (
    <SegmentedControl
      size={size}
      aria-label={t('onboarding.wizard.language')}
      options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
      value={language}
      onValueChange={(next) =>
        void useConfigStore
          .getState()
          .set({ general: { language: next } })
          .catch((e: unknown) =>
            toast.error(t('common.saveFailed'), { detail: e instanceof Error ? e.message : String(e) }),
          )
      }
    />
  )
}

export function StepsBar({ active }: { active: number }) {
  const t = useT()
  return (
    <ol className="flex items-center gap-2" aria-label={t('onboarding.wizard.stepsLabel')}>
      {STEP_LABELS.map((label, i) => {
        const state = i < active ? 'done' : i === active ? 'current' : 'todo'
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex size-5 items-center justify-center rounded-chip font-latin text-micro font-medium',
                state === 'current'
                  ? 'bg-accent text-(--fg-on-accent)'
                  : state === 'done'
                    ? 'bg-accent-15 text-accent'
                    : 'bg-line-8 text-fg-3',
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                'whitespace-nowrap text-caption',
                state === 'current' ? 'font-medium text-fg' : 'text-fg-3',
              )}
            >
              {t(label)}
            </span>
            {i < STEP_LABELS.length - 1 ? <span aria-hidden className="mx-1 h-px w-8 bg-line-8" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function OnboardingWizard({ onDone, onExit, modelStep, returning = false }: OnboardingWizardProps) {
  const t = useT()
  const config = useConfigStore((s) => s.config)
  const hydrated = useWizardStore((s) => s.hydrated)
  const hydrate = useWizardStore((s) => s.hydrate)
  const page = useWizardStore((s) => s.page)
  const setPage = useWizardStore((s) => s.setPage)
  const verified = useWizardStore((s) => s.verifyState === 'verified')
  const testing = useWizardStore((s) => s.testing)
  const testError = useWizardStore((s) => s.testError)
  const clearTestError = useWizardStore((s) => s.clearTestError)
  const connect = useWizardStore((s) => s.connect)
  const persistDraft = useWizardStore((s) => s.persistDraft)
  const loadAccounts = useWizardStore((s) => s.loadAccounts)
  const [exitOpen, setExitOpen] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownPage = useRef(page)

  useEffect(() => {
    if (config && !hydrated) void hydrate(config)
  }, [config, hydrated, hydrate])

  // A new step replaces the whole page: move focus to its heading so keyboard and screen-reader users land at
  // the top of it instead of on a button that no longer exists. The first paint keeps the default focus.
  useEffect(() => {
    if (shownPage.current === page) return
    shownPage.current = page
    headingRef.current?.focus()
  }, [page])

  // Nickname and avatar come from the opened database, which the main process is still opening at launch: list the
  // accounts again once it is ready, so the saved account shows its real name and picture.
  useBridgeEvent('substrate:event', (event) => {
    if (event.type === 'connection' && event.state === 'ready' && useWizardStore.getState().hydrated) {
      void loadAccounts()
    }
  })

  const finish = async (forceAcquire = false) => {
    const ok = await connect(forceAcquire)
    if (!ok) return
    if (returning) {
      onDone()
      return
    }
    toast.success(t('onboarding.wizard.connected'))
    // Someone who already has a model (re-running setup) goes straight in; everyone else gets 接入模型 next.
    if (modelStep && !hasUsableModel(useConfigStore.getState().config?.ai.providers)) setPage('model')
    else onDone()
  }

  const exit = async () => {
    await persistDraft()
    setExitOpen(false)
    ;(onExit ?? onDone)()
  }

  const active = activeStepIndex(page, verified, testing)
  const activeLabel = STEP_LABELS[active]

  return (
    <div className="flex h-full w-full flex-col bg-shell text-fg">
      {/* Always mounted, so a change of step is announced; the steps bar itself stays a plain ordered list. */}
      <div role="status" className="sr-only">
        {activeLabel && !returning
          ? t('onboarding.wizard.stepStatus', { n: active + 1, total: STEP_LABELS.length, label: t(activeLabel) })
          : null}
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        {/* The welcome page carries its own, larger language choice; later pages keep this compact one. */}
        {page === 'welcome' && !returning ? <span /> : <LanguageSwitch size="sm" />}
        {returning ? null : (
          <Tooltip content={t('onboarding.wizard.exit')} side="bottom">
            <IconButton icon={X} label={t('onboarding.wizard.exit')} onClick={() => setExitOpen(true)} />
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {page === 'welcome' && !returning ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <WelcomeStep
              onNext={() => setPage('connect')}
              headingRef={headingRef}
              languageSwitch={<LanguageSwitch />}
            />
          </div>
        ) : page === 'model' && modelStep && !returning ? (
          modelStep({
            onBack: () => setPage('connect'),
            onFinish: onDone,
            stepsBar: <StepsBar active={active} />,
            headingRef,
          })
        ) : (
          <ConnectStep
            onBack={() => setPage('welcome')}
            onNext={() => void finish()}
            stepsBar={returning ? null : <StepsBar active={active} />}
            headingRef={headingRef}
            returning={returning}
          />
        )}
      </div>

      <ExitDialog open={exitOpen} onOpenChange={setExitOpen} onExit={() => void exit()} />
      <ConnectFailDialog
        error={testError}
        onOpenChange={(o) => !o && clearTestError()}
        onReacquire={() => void finish(true)}
      />
    </div>
  )
}
