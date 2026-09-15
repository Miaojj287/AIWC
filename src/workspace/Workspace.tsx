import { Bot, CalendarClock, MessageSquare, Reply, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { installTabCommands } from '@/app/tabCommands'
import { detectMac } from '@/app/shortcuts'
import { Trans, useT, type MessageKey } from '@/i18n'
import { ConfirmDialog, EmptyState, ErrorBoundary, Kbd, type IconComponent } from '@/kit'
import { getObjectList } from '@/shell/objectListRegistry'
import { useShellStore, type RailFunction } from '@/shell/shellStore'
import { getTabRegistration, tabTitle, type TabDescriptor } from './tabRegistry'
import { TabStrip } from './TabStrip'
import { useTabsStore } from './tabsStore'

/** Tabs kept mounted (hidden) after the active one so switching back restores scroll / drafts. */
export const KEEP_MOUNTED = 3

export interface WorkspaceProps {
  mac?: boolean
}

/**
 * Workspace — the Tab container (CLAUDE.md §1): TabStrip on the shell ground, the active tab's renderer
 * on the content ground, the last 3 visited tabs kept mounted but hidden, a per-function empty state,
 * and the dirty-guard dialog. Handles tab.* / rail.select / agent.quoteActiveTab commands.
 */
export function Workspace({ mac = detectMac() }: WorkspaceProps) {
  const t = useT()
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const rail = useShellStore((s) => s.railFunction)
  const guard = useCloseGuard()
  const { requestClose } = guard

  useEffect(() => installTabCommands({ requestClose: (id) => void requestClose(id) }), [requestClose])

  const mounted = useRecentTabs(tabs, activeId)
  const active = activeId ? tabs.find((t) => t.id === activeId) : undefined

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-shell" aria-label={t('workspace.ariaLabel')}>
      <TabStrip onRequestClose={guard.requestClose} mac={mac} />
      <div className="relative min-h-0 flex-1 bg-content">
        {!active ? <FunctionEmpty fn={rail} mac={mac} /> : null}
        {mounted.map((tab) => (
          <TabHost key={tab.id} tab={tab} active={tab.id === activeId} requestClose={guard.requestClose} />
        ))}
      </div>
      {guard.dialog}
    </section>
  )
}

/* ---------------------------------------------------------------- host */

function TabHost({
  tab,
  active,
  requestClose,
}: {
  tab: TabDescriptor
  active: boolean
  requestClose(id: string): void
}) {
  const t = useT()
  const reg = getTabRegistration(tab.kind)
  const update = useCallback(
    (patch: Partial<Pick<TabDescriptor, 'title' | 'dirty' | 'state'>>) => useTabsStore.getState().update(tab.id, patch),
    [tab.id],
  )
  const close = useCallback(() => requestClose(tab.id), [requestClose, tab.id])
  return (
    <div
      hidden={!active}
      role="tabpanel"
      aria-label={tabTitle(tab)}
      data-tab-id={tab.id}
      className="absolute inset-0 flex min-h-0 flex-col"
    >
      {reg ? (
        // One boundary per host: a tab that throws while rendering shows the error state in its own panel only.
        <ErrorBoundary>
          <reg.component tab={tab} active={active} update={update} requestClose={close} />
        </ErrorBoundary>
      ) : (
        <EmptyState
          variant="error"
          title={t('workspace.tabError')}
          action={{ label: t('workspace.closeTab'), onClick: close }}
          className="h-full"
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------- empty state */

const EMPTY_COPY: Record<RailFunction, { icon: IconComponent; title: MessageKey; description: MessageKey }> = {
  chat: { icon: MessageSquare, title: 'workspace.empty.chat.title', description: 'workspace.empty.chat.description' },
  autoreply: {
    icon: Reply,
    title: 'workspace.empty.autoreply.title',
    description: 'workspace.empty.autoreply.description',
  },
  clone: { icon: Bot, title: 'workspace.empty.clone.title', description: 'workspace.empty.clone.description' },
  tasks: {
    icon: CalendarClock,
    title: 'workspace.empty.tasks.title',
    description: 'workspace.empty.tasks.description',
  },
}

/** A function may bring its own empty state (定时任务 offers templates); the rest share the generic copy. */
function FunctionEmpty({ fn, mac }: { fn: RailFunction; mac: boolean }) {
  const Custom = getObjectList(fn)?.workspaceEmpty
  return Custom ? <Custom mac={mac} /> : <WorkspaceEmpty fn={fn} mac={mac} />
}

function WorkspaceEmpty({ fn, mac }: { fn: RailFunction; mac: boolean }) {
  const t = useT()
  const copy = EMPTY_COPY[fn]
  return (
    <EmptyState
      icon={copy.icon}
      title={t(copy.title)}
      description={
        <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
          <span>{t(copy.description)}</span>
          <span aria-hidden className="text-fg-3/60">
            ·
          </span>
          <span className="inline-flex items-center gap-1">
            <Trans k="workspace.empty.search" params={{ kbd: <Kbd keys={mac ? '⌘K' : 'Ctrl+K'} /> }} />
          </span>
        </span>
      }
      className="h-full"
      data-testid="workspace-empty"
    />
  )
}

/* ------------------------------------------------------------ recent MRU */

/** Active tab first, then up to KEEP_MOUNTED-1 most recently visited tabs that still exist. */
export function useRecentTabs(tabs: TabDescriptor[], activeId: string | null): TabDescriptor[] {
  const mru = useRef<string[]>([])
  if (activeId) {
    mru.current = [activeId, ...mru.current.filter((id) => id !== activeId)]
  }
  const ids = new Set(tabs.map((t) => t.id))
  mru.current = mru.current.filter((id) => ids.has(id)).slice(0, KEEP_MOUNTED)
  return mru.current.map((id) => tabs.find((t) => t.id === id)).filter((t): t is TabDescriptor => Boolean(t))
}

/* ----------------------------------------------------------- dirty guard */

interface PendingClose {
  tab: TabDescriptor
  resolve(ok: boolean): void
}

export interface CloseGuard {
  /** Close the tab, asking first when it is dirty (registration.canClose or the default dialog). */
  requestClose(id: string): Promise<boolean>
  dialog: ReactNode
}

export function useCloseGuard(): CloseGuard {
  const t = useT()
  const [pending, setPending] = useState<PendingClose | null>(null)

  const requestClose = useCallback(async (id: string): Promise<boolean> => {
    const store = useTabsStore.getState()
    const tab = store.tabs.find((t) => t.id === id)
    if (!tab) return false
    if (!tab.dirty) {
      store.close(id)
      return true
    }
    const reg = getTabRegistration(tab.kind)
    const ok = reg?.canClose
      ? await reg.canClose(tab)
      : await new Promise<boolean>((resolve) => setPending({ tab, resolve }))
    if (ok) useTabsStore.getState().close(id)
    return ok
  }, [])

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && settle(false)}
      icon={TriangleAlert}
      tone="warn"
      title={t('workspace.discard.title')}
      description={pending ? t('workspace.discard.description', { title: tabTitle(pending.tab) }) : undefined}
      confirmLabel={t('workspace.discard.confirm')}
      cancelLabel={t('common.cancel')}
      onConfirm={() => settle(true)}
    />
  )

  return { requestClose, dialog }
}
