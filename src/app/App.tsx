import { useEffect, useState } from 'react'
import type { AiwcBridge, ToastPayload } from '@aiwc/protocol'
import { AgentWindow } from '@/features/agent'
import { OnboardingWizard } from '@/features/onboarding'
import { useT } from '@/i18n'
import { EmptyState, Spinner, Toaster, TooltipProvider, toast } from '@/kit'
import { getBridge } from '@/platform/bridge'
import { useConfig, useConfigStore } from '@/platform/configStore'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { Shell } from '@/shell/Shell'
import { CloseBehaviorDialog, type CloseBehavior } from './CloseBehaviorDialog'
import { onCommand, runCommand, type CommandMap, type CommandName } from './commands'
import { completeOnboarding } from './completeOnboarding'
import { registerFeatures } from './registerFeatures'
import { installShellModeCommands } from './shellMode'
import { detectMac, installShortcuts } from './shortcuts'

/**
 * App — renderer root. Hydrates config (which stamps the theme), registers features, then renders the
 * Onboarding wizard (single page, no columns) until `onboarding.completed`, otherwise the four-column
 * Shell. Providers: Tooltip, Toaster, global shortcuts, main-process events (commands / toasts / close).
 */
export function App() {
  const t = useT()
  const hydrated = useConfigStore((s) => s.hydrated)
  const error = useConfigStore((s) => s.error)
  const completed = useConfig((c) => c.onboarding.completed)
  const shellMode = useConfig((c) => c.ui.shellMode) ?? 'workbench'
  const [bridge, setBridge] = useState<Pick<AiwcBridge, 'platform' | 'runtime'> | null>(null)

  useEffect(() => {
    registerFeatures()
    void getBridge().then((b) => setBridge({ platform: b.platform, runtime: b.runtime }))
    void useConfigStore
      .getState()
      .hydrate()
      .catch(() => undefined)
  }, [])

  if (!hydrated || !bridge) {
    return (
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
        ) : (
          <Spinner size={24} label={t('app.starting')} />
        )}
      </div>
    )
  }

  return (
    <TooltipProvider>
      {!completed ? (
        <OnboardingWizard onDone={() => void completeOnboarding()} />
      ) : shellMode === 'agent' ? (
        <AgentWindow platform={bridge.platform} runtime={bridge.runtime} />
      ) : (
        <Shell platform={bridge.platform} runtime={bridge.runtime} />
      )}
      <AppEvents platform={bridge.platform} runtime={bridge.runtime} shellActive={Boolean(completed)} />
      <Toaster />
    </TooltipProvider>
  )
}

interface AppEventsProps {
  platform: AiwcBridge['platform']
  runtime: AiwcBridge['runtime']
  shellActive: boolean
}

/** Global shortcuts, main → renderer events and the close-behaviour dialog. Renders only the dialog. */
function AppEvents({ platform, runtime, shellActive }: AppEventsProps) {
  const t = useT()
  const [closeAsked, setCloseAsked] = useState(false)

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

  useBridgeEvent('app:command', ({ command, payload }) => dispatch(command, payload))
  useBridgeEvent('app:toast', (p) => showToast(p))
  useBridgeEvent('app:closeRequested', () => setCloseAsked(true))

  const choose = (behavior: CloseBehavior, remember: boolean) => {
    setCloseAsked(false)
    void invoke('app:setCloseBehaviorOnce', { behavior, remember }).catch((e: unknown) =>
      toast.error(t('common.operationFailedDetail', { detail: e instanceof Error ? e.message : String(e) })),
    )
  }

  return <CloseBehaviorDialog open={closeAsked} onOpenChange={setCloseAsked} onChoose={choose} platform={platform} />
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
