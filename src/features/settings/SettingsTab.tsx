/**
 * The 设置 workspace Tab (single instance): left nav 200 + right scrolling content built from the five
 * pages. `tab.state` carries { page, highlight }; a highlight flashes its row for 2 s (DESIGN-SPEC §2).
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ConfirmDialog, ScrollArea } from '@/kit'
import { onCommand } from '@/app/commands'
import { detectMac, shortcutLabel } from '@/app/shortcuts'
import { useConfigStore } from '@/platform/configStore'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { PAGE_META, isSettingsPage, type SettingsPage, type SettingsTabState } from './model'
import { SettingsNav } from './SettingsNav'
import { GeneralPage } from './pages/GeneralPage'
import { AccountPage } from './pages/AccountPage'
import { AiPage } from './pages/AiPage'
import { MemoryPage } from './pages/MemoryPage'
import { AboutPage } from './pages/AboutPage'
import { DirtyContext, HighlightContext, PageHeader } from './pageKit'

export const HIGHLIGHT_MS = 2000

const PAGES: Record<SettingsPage, ComponentType> = {
  general: GeneralPage,
  account: AccountPage,
  ai: AiPage,
  memory: MemoryPage,
  about: AboutPage,
}

export function SettingsTab({ tab, active, update }: TabRendererProps) {
  const state = (tab.state ?? {}) as SettingsTabState
  const page: SettingsPage = isSettingsPage(state.page) ? state.page : 'general'
  const highlight = state.highlight
  const searchRef = useRef<HTMLInputElement>(null)
  const stateRef = useRef(tab.state)
  stateRef.current = tab.state

  // Unsaved edits inside a page (记忆 editor today) must survive a mis-click: they mark the tab dirty
  // — which lights the tab's dot and arms the workspace close guard — and gate page navigation.
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingPage, setPendingPage] = useState<{ page: SettingsPage; highlight?: string } | null>(null)
  const reportDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      if (prev.has(key) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  const dirty = dirtyKeys.size > 0
  useEffect(() => {
    if (tab.dirty !== dirty) update({ dirty })
  }, [dirty, tab.dirty, update])

  useEffect(() => {
    void useConfigStore.getState().hydrate().catch(() => undefined)
  }, [])

  // Clear the highlight after 2 s (the row stops flashing; state stays clean for the next search).
  useEffect(() => {
    if (!highlight) return
    const t = setTimeout(() => update({ state: { ...stateRef.current, highlight: undefined } }), HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [highlight, update])

  // ⌘F while this tab is active focuses the settings search.
  useEffect(() => {
    if (!active) return
    return onCommand('search.inPage', () => searchRef.current?.focus())
  }, [active])

  const go = useCallback((next: SettingsPage, hl?: string) => update({ state: { ...stateRef.current, page: next, highlight: hl } }), [update])
  const navigate = (next: SettingsPage, hl?: string) => {
    if (dirty && next !== page) setPendingPage({ page: next, highlight: hl })
    else go(next, hl)
  }

  const Page = PAGES[page]
  const meta = PAGE_META[page]

  return (
    <div className="flex h-full min-h-0 w-full bg-content">
      <SettingsNav page={page} onNavigate={navigate} searchRef={searchRef} shortcutLabel={shortcutLabel('search.inPage', detectMac())} />
      <ScrollArea className="min-w-0 flex-1">
        <HighlightContext.Provider value={highlight}>
          <DirtyContext.Provider value={reportDirty}>
            <div key={page} className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-7 pb-10 pt-6">
              <PageHeader title={meta.title} description={meta.description} />
              <Page />
            </div>
          </DirtyContext.Provider>
        </HighlightContext.Provider>
      </ScrollArea>
      <ConfirmDialog
        open={pendingPage !== null}
        onOpenChange={(o) => !o && setPendingPage(null)}
        icon={TriangleAlert}
        tone="warn"
        title="放弃未保存的修改？"
        description={`「${meta.title}」里有还没保存的修改，离开后这些修改会丢失。`}
        confirmLabel="放弃修改并离开"
        cancelLabel="继续编辑"
        onConfirm={() => {
          const next = pendingPage
          setPendingPage(null)
          if (next) go(next.page, next.highlight)
        }}
      />
    </div>
  )
}
