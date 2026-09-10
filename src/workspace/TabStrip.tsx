import { Check, Ellipsis, Pin, PinOff, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
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
import { getTabRegistration, type TabDescriptor } from './tabRegistry'
import { useTabsStore } from './tabsStore'

export interface TabStripProps {
  /** Close with the dirty guard; resolves true when the tab was closed. */
  onRequestClose(id: string): Promise<boolean> | boolean | void
  mac?: boolean
}

/**
 * TabStrip — h40 shell ground (Figma 119:415). kit Tab per descriptor: active = content ground + top r8,
 * pinned first without ×, dirty dot, middle-click closes, pointer-drag reorders, right-click menu,
 * horizontal overflow scroll with a `···` manager menu on the right (DESIGN-SPEC §0.3).
 */
export function TabStrip({ onRequestClose, mac = true }: TabStripProps) {
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
  const closeOthers = useCallback((id: string) => closeMany(store().tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id)), [closeMany, store])
  const closeToRight = useCallback(
    (id: string) => {
      const list = store().tabs
      const idx = list.findIndex((t) => t.id === id)
      return closeMany(list.slice(idx + 1).filter((t) => !t.pinned).map((t) => t.id))
    },
    [closeMany, store],
  )

  const drag = useTabDrag()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { elementOf } = drag
  useEffect(() => {
    if (!activeId) return
    const el = elementOf(activeId)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, elementOf])

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
    <div className="workspace-tab-strip flex h-10 shrink-0 items-stretch bg-shell pr-2" data-testid="tab-strip">
      <div ref={scrollRef} role="tablist" aria-label="工作区标签" onWheel={onWheel} className="scrollbar-none flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden">
        {tabs.map((tab, index) => {
          const reg = getTabRegistration(tab.kind)
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <Tab
                  ref={(el) => drag.register(tab.id, el)}
                  icon={tabIcon(tab.kind, reg?.icon)}
                  label={tab.title}
                  active={tab.id === activeId}
                  pinned={tab.pinned}
                  dirty={tab.dirty}
                  activeBg="content"
                  data-tab-id={tab.id}
                  data-dragging={drag.draggingId === tab.id || undefined}
                  className={cn(drag.draggingId === tab.id && 'opacity-70')}
                  onSelect={() => store().activate(tab.id)}
                  onClose={() => void onRequestClose(tab.id)}
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
            <IconButton icon={Ellipsis} label="标签管理" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuItems items={overflow} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

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
    { id: 'close', label: '关闭', icon: X, shortcut: shortcutLabel('tab.closeActive', ctx.mac), disabled: Boolean(tab.pinned), onSelect: ctx.close },
    { id: 'closeOthers', label: '关闭其他', disabled: !ctx.hasOthers, onSelect: ctx.closeOthers },
    { id: 'closeRight', label: '关闭右侧', disabled: !ctx.hasRight, onSelect: ctx.closeRight },
    { type: 'separator' },
    { id: 'pin', label: tab.pinned ? '取消固定' : '固定标签', icon: tab.pinned ? PinOff : Pin, onSelect: ctx.togglePin },
    { type: 'separator' },
    { id: 'reopen', label: '恢复已关闭的标签', icon: RotateCcw, shortcut: shortcutLabel('tab.reopenClosed', ctx.mac), disabled: !ctx.canReopen, onSelect: ctx.reopen },
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
export function overflowMenuSpec(tabs: readonly TabDescriptor[], activeId: string | null, ctx: OverflowMenuContext): MenuSpec {
  const items: MenuSpec = [{ type: 'label', id: 'tabs', label: tabs.length ? `标签页 · ${tabs.length}` : '没有打开的标签' }]
  for (const tab of tabs) {
    items.push({
      id: `tab:${tab.id}`,
      label: tab.title,
      icon: tabIcon(tab.kind, getTabRegistration(tab.kind)?.icon),
      badge: tab.id === activeId ? <Check size={12} strokeWidth={2} aria-label="当前" className="text-accent" /> : undefined,
      onSelect: () => ctx.activate(tab.id),
    })
  }
  items.push(
    { type: 'separator' },
    { id: 'reopen', label: '恢复已关闭的标签', icon: RotateCcw, shortcut: shortcutLabel('tab.reopenClosed', ctx.mac), disabled: !ctx.canReopen, onSelect: ctx.reopen },
    { id: 'closeOthers', label: '关闭其他', disabled: !activeId || tabs.filter((t) => t.id !== activeId && !t.pinned).length === 0, onSelect: ctx.closeOthers },
    {
      id: 'closeRight',
      label: '关闭右侧',
      disabled: !activeId || !tabs.slice(tabs.findIndex((t) => t.id === activeId) + 1).some((t) => !t.pinned),
      onSelect: ctx.closeRight,
    },
  )
  return items
}

/* ------------------------------------------------------------------- drag */

const DRAG_THRESHOLD = 4

interface DragSession {
  id: string
  pointerId: number
  startX: number
  moved: boolean
}

/**
 * Pointer-event reorder (no dnd lib): press activates, moving past 4px starts a drag, the tab jumps to
 * the slot whose midpoint the pointer crossed (store.move keeps pinned tabs first).
 */
function useTabDrag() {
  const elements = useRef(new Map<string, HTMLElement>())
  const session = useRef<DragSession | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

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
    session.current = { id, pointerId: e.pointerId, startX: e.clientX, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* jsdom / unsupported */
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = session.current
    if (!s || s.pointerId !== e.pointerId) return
    if (!s.moved) {
      if (Math.abs(e.clientX - s.startX) < DRAG_THRESHOLD) return
      s.moved = true
      setDraggingId(s.id)
    }
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
    if (to !== from) move(from, to)
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = session.current
    if (!s || s.pointerId !== e.pointerId) return
    session.current = null
    setDraggingId(null)
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  return { register, elementOf, draggingId, onPointerDown, onPointerMove, onPointerUp }
}
