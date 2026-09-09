import { Bot, MessageSquare, Reply, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { installTabCommands } from '@/app/tabCommands'
import { detectMac } from '@/app/shortcuts'
import { ConfirmDialog, EmptyState, Kbd, type IconComponent } from '@/kit'
import { useShellStore, type RailFunction } from '@/shell/shellStore'
import { getTabRegistration, type TabDescriptor } from './tabRegistry'
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
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const rail = useShellStore((s) => s.railFunction)
  const guard = useCloseGuard()

  useEffect(() => installTabCommands({ requestClose: (id) => void guard.requestClose(id) }), [guard.requestClose])

  const mounted = useRecentTabs(tabs, activeId)
  const active = activeId ? tabs.find((t) => t.id === activeId) : undefined

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-shell" aria-label="工作区">
      <TabStrip onRequestClose={guard.requestClose} mac={mac} />
      <div className="relative min-h-0 flex-1 bg-content">
        {!active ? <WorkspaceEmpty fn={rail} mac={mac} /> : null}
        {mounted.map((tab) => (
          <TabHost key={tab.id} tab={tab} active={tab.id === activeId} requestClose={guard.requestClose} />
        ))}
      </div>
      {guard.dialog}
    </section>
  )
}

/* ---------------------------------------------------------------- host */

function TabHost({ tab, active, requestClose }: { tab: TabDescriptor; active: boolean; requestClose(id: string): void }) {
  const reg = getTabRegistration(tab.kind)
  const update = useCallback((patch: Partial<Pick<TabDescriptor, 'title' | 'dirty' | 'state'>>) => useTabsStore.getState().update(tab.id, patch), [tab.id])
  const close = useCallback(() => requestClose(tab.id), [requestClose, tab.id])
  return (
    <div hidden={!active} role="tabpanel" aria-label={tab.title} data-tab-id={tab.id} className="absolute inset-0 flex min-h-0 flex-col">
      {reg ? (
        <reg.component tab={tab} active={active} update={update} requestClose={close} />
      ) : (
        <EmptyState variant="error" title="无法显示此标签" description={`没有为「${tab.kind}」类型注册渲染器。`} action={{ label: '关闭标签', onClick: close }} className="h-full" />
      )}
    </div>
  )
}

/* ---------------------------------------------------------- empty state */

const EMPTY_COPY: Record<RailFunction, { icon: IconComponent; title: string; description: string }> = {
  chat: { icon: MessageSquare, title: '从左侧选择一个会话', description: '打开后可以浏览、搜索和导出聊天记录，或把它引用给 Agent。' },
  autoreply: { icon: Reply, title: '选择一个会话来设置自动回复', description: '每个会话至多一条规则；开启后由本地 Agent 按你的设置回复。' },
  clone: { icon: Bot, title: '选择一位联系人开始克隆', description: '克隆基于本地聊天记录提炼说话风格，全过程在本机完成。' },
}

function WorkspaceEmpty({ fn, mac }: { fn: RailFunction; mac: boolean }) {
  const copy = EMPTY_COPY[fn]
  return (
    <EmptyState
      icon={copy.icon}
      title={copy.title}
      description={
        <span className="inline-flex flex-wrap items-center justify-center gap-1">
          {copy.description}
          <span className="inline-flex items-center gap-1">
            按 <Kbd keys={mac ? '⌘K' : 'Ctrl+K'} /> 搜索
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
    const ok = reg?.canClose ? await reg.canClose(tab) : await new Promise<boolean>((resolve) => setPending({ tab, resolve }))
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
      title="放弃修改？"
      description={pending ? `「${pending.tab.title}」有未保存的修改，关闭后这些修改会丢失。` : undefined}
      confirmLabel="放弃修改"
      cancelLabel="取消"
      onConfirm={() => settle(true)}
    />
  )

  return { requestClose, dialog }
}
