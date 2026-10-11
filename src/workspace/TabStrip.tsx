import { Check, Ellipsis, Pin, PinOff, RotateCcw, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { shortcutLabel } from '@/app/shortcuts'
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  Tab,
  type MenuSpec,
} from '@/kit'
import { tabIcon } from './tabIcons'
import { t, useLanguage } from '@/i18n'
import { getTabRegistration, tabTitle, type TabDescriptor } from './tabRegistry'
import { useTabsStore } from './tabsStore'

export interface TabStripProps {
  /** Close with the dirty guard; resolves true when the tab was closed. */
  onRequestClose(id: string): Promise<boolean> | boolean | void
  mac?: boolean
}

/**
 * TabStrip — h40 content ground. kit Tab per descriptor: active = primary text + close button,
 * pinned first without ×, dirty dot, middle-click closes, pointer-drag reorders, right-click menu,
 * horizontal overflow scroll with a `···` manager menu on the right (DESIGN-SPEC §0.3).
 */
export function TabStrip({ onRequestClose, mac = true }: TabStripProps) {
  useLanguage() // registered tab titles are localized at render
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const canReopen = useTabsStore((s) => s.recentlyClosed.length > 0)
  const store = useTabsStore.getState

  const closeMany = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await onRequestClose(id)
    },
    [onRequestClose],
  )
  const closeOthers = useCallback(
    (id: string) =>
      closeMany(
        store()
          .tabs.filter((t) => t.id !== id && !t.pinned)
          .map((t) => t.id),
      ),
    [closeMany, store],
  )
  const closeToRight = useCallback(
    (id: string) => {
      const list = store().tabs
      const idx = list.findIndex((t) => t.id === id)
      return closeMany(
        list
          .slice(idx + 1)
          .filter((t) => !t.pinned)
          .map((t) => t.id),
      )
    },
    [closeMany, store],
  )

  const drag = useTabDrag(tabs.map((tab) => tab.id).join('|'))
  const scrollRef = useRef<HTMLDivElement>(null)
  const manageRef = useRef<HTMLButtonElement>(null)
  // A tab closed while it held focus would drop focus to <body>: hand it to the tab that became active.
  const refocus = useRef(false)

  const { elementOf } = drag
  useEffect(() => {
    if (activeId) {
      const el = elementOf(activeId)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    if (!refocus.current) return
    refocus.current = false
    const next = activeId ? elementOf(activeId) : undefined
    ;(next ?? manageRef.current)?.focus()
  }, [activeId, elementOf, tabs.length])

  const closeFromStrip = (id: string) => {
    refocus.current = Boolean(scrollRef.current?.contains(document.activeElement))
    void onRequestClose(id)
  }

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    el.scrollLeft += e.deltaY
  }

  const menuFor = (tab: TabDescriptor, index: number): MenuSpec =>
    tabMenuSpec(tab, {
      mac,
      canReopen,
      hasOthers: tabs.some((t) => t.id !== tab.id && !t.pinned),
      hasRight: tabs.slice(index + 1).some((t) => !t.pinned),
      close: () => void onRequestClose(tab.id),
      closeOthers: () => void closeOthers(tab.id),
      closeRight: () => void closeToRight(tab.id),
      togglePin: () => store().pin(tab.id, !tab.pinned),
      reopen: () => store().reopenLastClosed(),
    })

  const overflow = overflowMenuSpec(tabs, activeId, {
    mac,
    canReopen,
    activate: (id) => store().activate(id),
    reopen: () => store().reopenLastClosed(),
    closeOthers: () => {
      if (activeId) void closeOthers(activeId)
    },
    closeRight: () => {
      if (activeId) void closeToRight(activeId)
    },
  })

  return (
    <div className="workspace-tab-strip flex h-10 shrink-0 items-stretch bg-content pr-2" data-testid="tab-strip">
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={t('workspace.tabStrip.ariaLabel')}
        onWheel={onWheel}
        className="scrollbar-none flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab, index) => {
          const reg = getTabRegistration(tab.kind)
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <Tab
                  ref={(el) => drag.register(tab.id, el)}
                  icon={tabIcon(tab.kind, reg?.icon)}
                  label={tabTitle(tab)}
                  active={tab.id === activeId}
                  pinned={tab.pinned}
                  dirty={tab.dirty}
                  activeBg="content"
                  id={tabDomId(tab.id)}
                  aria-controls={tabPanelDomId(tab.id)}
                  data-tab-id={tab.id}
                  data-dragging={drag.draggingId === tab.id || undefined}
                  // The dragged tab rides above its neighbours while they slide out of its way.
                  className={cn(drag.draggingId === tab.id && 'z-10')}
                  onSelect={() => store().activate(tab.id)}
                  onClose={() => closeFromStrip(tab.id)}
                  onPointerDown={(e) => drag.onPointerDown(e, tab.id)}
                  onPointerMove={drag.onPointerMove}
                  onPointerUp={drag.onPointerUp}
                  onPointerCancel={drag.onPointerUp}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menuFor(tab, index)} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center pl-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton ref={manageRef} icon={Ellipsis} label={t('workspace.tabStrip.manage')} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItems items={overflow} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** DOM ids that tie a tab to its panel (`aria-controls` / `aria-labelledby`). */
export const tabDomId = (tabId: string): string => `tab-${tabId}`
export const tabPanelDomId = (tabId: string): string => `tabpanel-${tabId}`

/* ------------------------------------------------------------------ menus */

export interface TabMenuContext {
  mac: boolean
  canReopen: boolean
  hasOthers: boolean
  hasRight: boolean
  close(): void
  closeOthers(): void
  closeRight(): void
  togglePin(): void
  reopen(): void
}

/** Per-tab right-click menu (Figma 149:415 ③): 关闭 / 关闭其他 / 关闭右侧 — 固定标签 — 恢复已关闭. */
export function tabMenuSpec(tab: TabDescriptor, ctx: TabMenuContext): MenuSpec {
  return [
    {
      id: 'close',
      label: t('workspace.tabStrip.close'),
      icon: X,
      shortcut: shortcutLabel('tab.closeActive', ctx.mac),
      disabled: Boolean(tab.pinned),
      onSelect: ctx.close,
    },
    {
      id: 'closeOthers',
      label: t('workspace.tabStrip.closeOthers'),
      disabled: !ctx.hasOthers,
      onSelect: ctx.closeOthers,
    },
    { id: 'closeRight', label: t('workspace.tabStrip.closeRight'), disabled: !ctx.hasRight, onSelect: ctx.closeRight },
    { type: 'separator' },
    {
      id: 'pin',
      label: tab.pinned ? t('workspace.tabStrip.unpin') : t('workspace.tabStrip.pin'),
      icon: tab.pinned ? PinOff : Pin,
      onSelect: ctx.togglePin,
    },
    { type: 'separator' },
    {
      id: 'reopen',
      label: t('workspace.tabStrip.reopen'),
      icon: RotateCcw,
      shortcut: shortcutLabel('tab.reopenClosed', ctx.mac),
      disabled: !ctx.canReopen,
      onSelect: ctx.reopen,
    },
  ]
}

export interface OverflowMenuContext {
  mac: boolean
  canReopen: boolean
  activate(id: string): void
  reopen(): void
  closeOthers(): void
  closeRight(): void
}

/** The `···` manager: every open tab (check on the active one) — 恢复已关闭 / 关闭其他 / 关闭右侧. */
export function overflowMenuSpec(
  tabs: readonly TabDescriptor[],
  activeId: string | null,
  ctx: OverflowMenuContext,
): MenuSpec {
  const items: MenuSpec = [
    {
      type: 'label',
      id: 'tabs',
      label: tabs.length ? t('workspace.tabStrip.count', { n: tabs.length }) : t('workspace.tabStrip.none'),
    },
  ]
  for (const tab of tabs) {
    items.push({
      id: `tab:${tab.id}`,
      label: tabTitle(tab),
      icon: tabIcon(tab.kind, getTabRegistration(tab.kind)?.icon),
      badge:
        tab.id === activeId ? (
          <Check size={12} strokeWidth={2} aria-label={t('workspace.tabStrip.current')} className="text-accent" />
        ) : undefined,
      onSelect: () => ctx.activate(tab.id),
    })
  }
  items.push(
    { type: 'separator' },
    {
      id: 'reopen',
      label: t('workspace.tabStrip.reopen'),
      icon: RotateCcw,
      shortcut: shortcutLabel('tab.reopenClosed', ctx.mac),
      disabled: !ctx.canReopen,
      onSelect: ctx.reopen,
    },
    {
      id: 'closeOthers',
      label: t('workspace.tabStrip.closeOthers'),
      disabled: !activeId || tabs.filter((t) => t.id !== activeId && !t.pinned).length === 0,
      onSelect: ctx.closeOthers,
    },
    {
      id: 'closeRight',
      label: t('workspace.tabStrip.closeRight'),
      disabled: !activeId || !tabs.slice(tabs.findIndex((t) => t.id === activeId) + 1).some((t) => !t.pinned),
      onSelect: ctx.closeRight,
    },
  )
  return items
}

/* ------------------------------------------------------------------- drag */

const DRAG_THRESHOLD = 4
/** Reorder motion mirrors tokens.css `--dur-fast` / `--ease-out`; WAAPI needs literal values. */
const REORDER_MS = 120
const REORDER_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'

interface DragSession {
  id: string
  pointerId: number
  startX: number
  /** Pointer x minus the tab's left edge at grab time: the tab stays under the finger where it was grabbed. */
  grabOffset: number
  /** The translateX currently applied to the dragged tab. */
  offset: number
  lastX: number
  moved: boolean
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Layout left of a tab with any slide still in flight cancelled, so the next slide starts from a clean slot. */
function settledLeft(el: HTMLElement): number {
  if (typeof el.getAnimations === 'function') for (const running of el.getAnimations()) running.cancel()
  return el.getBoundingClientRect().left
}

function slide(el: HTMLElement, fromX: number): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion() || Math.abs(fromX) < 0.5) return
  el.animate([{ transform: `translateX(${fromX}px)` }, { transform: 'translateX(0)' }], {
    duration: REORDER_MS,
    easing: REORDER_EASING,
  })
}

/**
 * Pointer-event reorder (no dnd lib): press activates, moving past 4px starts a drag. The dragged tab follows the
 * pointer 1:1 (a transform, never layout), the store reorders when the pointer crosses a neighbour's midpoint
 * (store.move keeps pinned tabs first), the neighbours slide into their new slots (FLIP, 120ms) and the dragged tab
 * settles into its slot on release. `order` is the current tab order: a change re-anchors the transform after React
 * has moved the DOM nodes.
 */
function useTabDrag(order: string) {
  const elements = useRef(new Map<string, HTMLElement>())
  const session = useRef<DragSession | null>(null)
  const before = useRef<Map<string, number> | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /** Keep the dragged tab under the pointer: layout left (rect minus our own offset) → the wanted left. */
  const follow = useCallback(() => {
    const s = session.current
    const el = s ? elements.current.get(s.id) : undefined
    if (!s || !el || !s.moved) return
    const layoutLeft = el.getBoundingClientRect().left - s.offset
    s.offset = s.lastX - s.grabOffset - layoutLeft
    el.style.transform = `translateX(${s.offset}px)`
  }, [])

  useLayoutEffect(() => {
    const previous = before.current
    before.current = null
    follow()
    if (!previous) return
    const draggedId = session.current?.id
    for (const [id, el] of elements.current) {
      if (id === draggedId) continue
      // `was` is where the tab was drawn (mid-slide included), so a reversal continues from there instead of jumping.
      const was = previous.get(id)
      if (was !== undefined) slide(el, was - settledLeft(el))
    }
  }, [order, follow])

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el)
    else elements.current.delete(id)
  }, [])
  const elementOf = useCallback((id: string) => elements.current.get(id), [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const store = useTabsStore.getState()
    if (store.activeId !== id) store.activate(id)
    session.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      grabOffset: e.clientX - e.currentTarget.getBoundingClientRect().left,
      offset: 0,
      lastX: e.clientX,
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* jsdom / unsupported */
    }
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = session.current
      if (!s || s.pointerId !== e.pointerId) return
      if (!s.moved) {
        if (Math.abs(e.clientX - s.startX) < DRAG_THRESHOLD) return
        s.moved = true
        setDraggingId(s.id)
      }
      s.lastX = e.clientX
      const { tabs, move } = useTabsStore.getState()
      const from = tabs.findIndex((t) => t.id === s.id)
      if (from < 0) return
      let to = from
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]
        if (!tab || tab.id === s.id) continue
        const rect = elements.current.get(tab.id)?.getBoundingClientRect()
        if (!rect) continue
        const mid = rect.left + rect.width / 2
        if (i < from && e.clientX < mid) {
          to = i
          break
        }
        if (i > from && e.clientX > mid) to = i
      }
      if (to !== from) {
        // FLIP: remember where every neighbour is before the store reorders them.
        before.current = new Map(
          [...elements.current].map(([tabId, el]) => [tabId, el.getBoundingClientRect().left] as const),
        )
        move(from, to)
      }
      follow()
    },
    [follow],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = session.current
    if (!s || s.pointerId !== e.pointerId) return
    session.current = null
    setDraggingId(null)
    // Settle into the slot from wherever the pointer left the tab.
    const el = elements.current.get(s.id)
    if (el && s.moved) {
      el.style.transform = ''
      slide(el, s.offset)
    }
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  return { register, elementOf, draggingId, onPointerDown, onPointerMove, onPointerUp }
}
