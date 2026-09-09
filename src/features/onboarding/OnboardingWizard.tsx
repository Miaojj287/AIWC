/**
 * OnboardingWizard — the only screen without the four columns (CLAUDE.md §1). Full-window frame with
 * the exit ×, the page (欢迎 / 连接与解锁) and the steps bar 欢迎 → 连接微信 → 解锁数据 → 完成.
 * `onDone` fires after a successful connection test; `onExit` (optional) after the exit confirmation.
 */
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton, Tooltip, cn, toast } from '@/kit'
import { useConfigStore } from '@/platform/configStore'
import { ConnectStep } from './ConnectStep'
import { WelcomeStep } from './WelcomeStep'
import { ConnectFailDialog, ExitDialog } from './dialogs'
import { STEP_LABELS, activeStepIndex } from './gating'
import { useWizardStore } from './wizardStore'

export interface OnboardingWizardProps {
  /** Connection test passed and `onboarding.completed` was persisted. */
  onDone(): void
  /** The user confirmed leaving the wizard; entered values are already mirrored into AppConfig. */
  onExit?(): void
}

export function StepsBar({ active }: { active: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="设置步骤">
      {STEP_LABELS.map((label, i) => {
        const state = i < active ? 'done' : i === active ? 'current' : 'todo'
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex size-5 items-center justify-center rounded-chip font-latin text-micro font-medium',
                state === 'current' ? 'bg-accent text-(--fg-on-accent)' : state === 'done' ? 'bg-accent-15 text-accent' : 'bg-line-8 text-fg-3',
              )}
            >
              {i + 1}
            </span>
            <span className={cn('text-caption', state === 'current' ? 'font-medium text-fg' : 'text-fg-3')}>{label}</span>
            {i < STEP_LABELS.length - 1 ? <span aria-hidden className="mx-1 h-px w-8 bg-line-8" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export function OnboardingWizard({ onDone, onExit }: OnboardingWizardProps) {
  const config = useConfigStore((s) => s.config)
  const hydrated = useWizardStore((s) => s.hydrated)
  const hydrate = useWizardStore((s) => s.hydrate)
  const page = useWizardStore((s) => s.page)
  const setPage = useWizardStore((s) => s.setPage)
  const verified = useWizardStore((s) => s.verifyState === 'verified')
  const testing = useWizardStore((s) => s.testing)
  const testError = useWizardStore((s) => s.testError)
  const clearTestError = useWizardStore((s) => s.clearTestError)
  const testAndFinish = useWizardStore((s) => s.testAndFinish)
  const persistDraft = useWizardStore((s) => s.persistDraft)
  const acquire = useWizardStore((s) => s.acquire)
  const [exitOpen, setExitOpen] = useState(false)

  useEffect(() => {
    if (config && !hydrated) void hydrate(config)
  }, [config, hydrated, hydrate])

  const finish = async () => {
    const ok = await testAndFinish()
    if (!ok) return
    toast.success('已连接，正在进入主界面')
    onDone()
  }

  const exit = async () => {
    await persistDraft()
    setExitOpen(false)
    ;(onExit ?? onDone)()
  }

  const active = activeStepIndex(page, verified, testing)

  return (
    <div className="flex h-full w-full flex-col bg-shell text-fg">
      <div className="flex h-12 shrink-0 items-center justify-end px-3">
        <Tooltip content="退出设置向导" side="bottom">
          <IconButton icon={X} label="退出设置向导" onClick={() => setExitOpen(true)} />
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1">
        {page === 'welcome' ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <WelcomeStep onNext={() => setPage('connect')} />
            <div className="flex justify-center pb-8">
              <StepsBar active={active} />
            </div>
          </div>
        ) : (
          <ConnectStep onBack={() => setPage('welcome')} onNext={() => void finish()} stepsBar={<StepsBar active={active} />} />
        )}
      </div>

      <ExitDialog open={exitOpen} onOpenChange={setExitOpen} onExit={() => void exit()} />
      <ConnectFailDialog error={testError} onOpenChange={(o) => !o && clearTestError()} onReacquire={() => void acquire('auto')} />
    </div>
  )
}
