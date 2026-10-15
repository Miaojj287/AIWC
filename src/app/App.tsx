import { useEffect, useState } from 'react'
import type { AiwcBridge, ToastPayload } from '@aiwc/protocol'
import { AgentWindow } from '@/features/agent'
import { LaunchSplash, OnboardingWizard } from '@/features/onboarding'
import { ModelSetupStep } from '@/features/settings'
import { useT } from '@/i18n'
import { EmptyState, Toaster, TooltipProvider, toast } from '@/kit'
import { getBridge } from '@/platform/bridge'
import { useConfig, useConfigStore } from '@/platform/configStore'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { installInputModality } from '@/platform/inputModality'
import { installWindowFocus } from '@/platform/windowFocus'
import { Shell } from '@/shell/Shell'
import { CloseBehaviorDialog, type CloseBehavior } from './CloseBehaviorDialog'
import { onCommand, runCommand, type CommandMap, type CommandName } from './commands'
import { completeOnboarding } from './completeOnboarding'
import { registerFeatures } from './registerFeatures'
import { installShellModeCommands } from './shellMode'
import { detectMac, installShortcuts } from './shortcuts'
import { ShortcutsDialog } from './ShortcutsDialog'

/**
 * App — renderer root. Hydrates config (which stamps the theme) behind the launch splash, registers features, then
 * renders the Onboarding wizard (single page, no columns). A first run walks the whole wizard; every later launch
 * shows the saved account's connection status and waits for explicit entry before opening the Shell or Agent window.
 */
export function App() {
  const t = useT()
  const hydrated = useConfigStore((s) => s.hydrated)
  const error = useConfigStore((s) => s.error)
  const completed = useConfig((c) => c.onboarding.completed)
  const shellMode = useConfig((c) => c.ui.shellMode) ?? 'workbench'
  const [bridge, setBridge] = useState<Pick<AiwcBridge, 'platform' | 'runtime'> | null>(null)
  const [splashDone, setSplashDone] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(installInputModality, [])
  useEffect(installWindowFocus, [])

  useEffect(() => {
    registerFeatures()
    void getBridge().then((b) => setBridge({ platform: b.platform, runtime: b.runtime }))
    void useConfigStore
      .getState()
      .hydrate()
      .catch(() => undefined)
  }, [])

  // The splash is always the last child of the same fragment, so it keeps animating while what is underneath
  // switches from the loading state to the first screen; it fades out over that screen.
  const splash = splashDone ? null : (
    <LaunchSplash ready={Boolean((hydrated && bridge) || error)} onFinished={() => setSplashDone(true)} />
  )

  if (!hydrated || !bridge) {
    return (
      <>
        <div className="flex h-full w-full items-center justify-center bg-shell text-fg">
          {error ? (
            <EmptyState
              variant="error"
              title={t('app.configError')}
              description={error.message}
              action={{
                label: t('common.retry'),
                onClick: () =>
                  void useConfigStore
                    .getState()
                    .hydrate()
                    .catch(() => undefined),
              }}
            />
          ) : null}
        </div>
        {splash}
      </>
    )
  }

  return (
    <>
      <TooltipProvider>
        {!completed ? (
          <OnboardingWizard
            onDone={() => {
              setEntered(true)
              void completeOnboarding()
            }}
            modelStep={(props) => <ModelSetupStep {...props} />}
          />
        ) : !entered ? (
          <OnboardingWizard returning onDone={() => setEntered(true)} />
        ) : shellMode === 'agent' ? (
          <AgentWindow platform={bridge.platform} runtime={bridge.runtime} />
        ) : (
          <Shell platform={bridge.platform} runtime={bridge.runtime} />
        )}
        <AppEvents platform={bridge.platform} runtime={bridge.runtime} shellActive={Boolean(completed && entered)} />
        <Toaster />
      </TooltipProvider>
      {splash}
    </>
  )
}

interface AppEventsProps {
  platform: AiwcBridge['platform']
  runtime: AiwcBridge['runtime']
  shellActive: boolean
}

/** Global shortcuts, main → renderer events, the close-behaviour dialog and the shortcut sheet. Renders only the dialogs. */
function AppEvents({ platform, runtime, shellActive }: AppEventsProps) {
  const t = useT()
  const [closeAsked, setCloseAsked] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    if (!shellActive) return
    return installShortcuts({ mac: detectMac(platform), web: runtime === 'web' })
  }, [platform, runtime, shellActive])
  // 工作台 ↔ Agent 窗口 (CLAUDE.md §12): one handler for every entry (pills, ⌘⇧L, menu, settings row).
  useEffect(() => {
    if (!shellActive) return
    return installShellModeCommands()
  }, [shellActive])

  useEffect(() => onCommand('toast', (p) => showToast(p)), [])
  useEffect(() => onCommand('app.showShortcuts', () => setShortcutsOpen(true)), [])

  useBridgeEvent('app:command', ({ command, payload }) => dispatch(command, payload))
  useBridgeEvent('app:toast', (p) => showToast(p))
  useBridgeEvent('app:closeRequested', () => setCloseAsked(true))

  const choose = (behavior: CloseBehavior, remember: boolean) => {
    setCloseAsked(false)
    void invoke('app:setCloseBehaviorOnce', { behavior, remember }).catch((e: unknown) =>
      toast.error(t('common.operationFailedDetail', { detail: e instanceof Error ? e.message : String(e) })),
    )
  }

  return (
    <>
      <CloseBehaviorDialog open={closeAsked} onOpenChange={setCloseAsked} onChoose={choose} platform={platform} />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        mac={detectMac(platform)}
        web={runtime === 'web'}
      />
    </>
  )
}

/** Untyped command from the menu / main process → the typed bus (unknown names only log a warning). */
function dispatch(command: string, payload: unknown): void {
  const run = runCommand as unknown as (name: CommandName, payload?: unknown) => void
  run(command as CommandName, payload)
}

function showToast(p: ToastPayload | CommandMap['toast']): void {
  const action = p.action
  toast({
    id: 'id' in p ? p.id : undefined,
    kind: p.kind,
    text: p.text,
    sticky: p.sticky,
    action: action ? { label: action.label, onClick: () => dispatch(action.command, action.payload) } : undefined,
  })
}
