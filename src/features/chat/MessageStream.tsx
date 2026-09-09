/**
 * Virtualised, bottom-aligned message list (virtua). Initial scroll to the latest message, older pages
 * load when the top comes into view, newer pages after a jump when the bottom does; `shift` keeps the
 * viewport anchored while pages are prepended. Short conversations sit at the bottom (mt-auto).
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import type { WxMessage } from '@aiwc/protocol'
import { EmptyState, Spinner, cn } from '@/kit'
import { DayPill, MessageRow, type MessageActions } from './MessageRow'
import { rowIndexOfMessage, type StreamRow } from './streamModel'
import type { StreamChange } from './useMessages'

const TOP_THRESHOLD = 240
const BOTTOM_THRESHOLD = 120
const CONTINUE_GAP_MS = 3 * 60_000

export interface MessageStreamProps extends MessageActions {
  rows: StreamRow[]
  loading: boolean
  error: string | undefined
  hasOlder: boolean
  loadingOlder: boolean
  hasNewer: boolean
  loadingNewer: boolean
  lastChange: StreamChange
  /** Re-run the initial bottom scroll when this changes. */
  windowKey: number
  /** Scroll to and flash this message (consumed via onFocused). */
  focusId: string | undefined
  focusNonce: number
  onFocused(): void
  onLoadOlder(): void
  onLoadNewer(): void
  onRetry(): void
  isGroup: boolean
  selectMode: boolean
  selectedIds: ReadonlySet<string>
  highlight?: string
  selfAvatar?: string
  senderAvatars?: ReadonlyMap<string, string | undefined>
  peerAvatar?: string
  mac: boolean
  filtered: boolean
}

const BottomAligned = forwardRef<HTMLDivElement, { style: CSSProperties; children: ReactNode }>(function BottomAligned({ style, children }, ref) {
  return (
    <div ref={ref} style={style} className="mt-auto w-full shrink-0">
      {children}
    </div>
  )
})

export function MessageStream(props: MessageStreamProps) {
  const { rows, loading, error, hasOlder, loadingOlder, hasNewer, loadingNewer, lastChange, windowKey, focusId, focusNonce, onFocused, onLoadOlder, onLoadNewer, onRetry, isGroup, selectMode, selectedIds, highlight, selfAvatar, senderAvatars, peerAvatar, mac, filtered, ...actions } = props
  const handle = useRef<VirtualizerHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [flashId, setFlashId] = useState<string | undefined>()
  const prevCount = useRef(0)
  const initialisedFor = useRef<number>(-1)

  const scrollToBottomRobust = useCallback((last: number) => {
    if (last < 0) return
    handle.current?.scrollToIndex(last, { align: 'end' })
    requestAnimationFrame(() => handle.current?.scrollToIndex(last, { align: 'end' }))
  }, [])

  // Initial scroll to the latest message whenever a new window is loaded (not after paging).
  useLayoutEffect(() => {
    if (loading || rows.length === 0) return
    if (initialisedFor.current === windowKey) return
    initialisedFor.current = windowKey
    if (focusId) return // the focus effect positions the viewport instead
    const last = rows.length - 1
    // Virtua measures rows after commit. Wait one frame, then correct once more after measurement;
    // otherwise a newly opened long chat can remain at the top of its latest page.
    const frame = requestAnimationFrame(() => scrollToBottomRobust(last))
    atBottom.current = true
    return () => cancelAnimationFrame(frame)
  }, [loading, rows.length, windowKey, focusId, scrollToBottomRobust])

  // Focus a message (jump / search / tab.openChat) once it is in the rows.
  useEffect(() => {
    if (!focusId || loading) return
    const idx = rowIndexOfMessage(rows, focusId)
    if (idx < 0) return
    handle.current?.scrollToIndex(idx, { align: 'center' })
    requestAnimationFrame(() => handle.current?.scrollToIndex(idx, { align: 'center' }))
    setFlashId(focusId)
    onFocused()
    const t = setTimeout(() => setFlashId((cur) => (cur === focusId ? undefined : cur)), 1800)
    return () => clearTimeout(t)
    // focusNonce lets the same id be focused twice in a row.
  }, [focusId, focusNonce, loading, rows, onFocused])

  // Live tail append: stick to the bottom when the user was already there.
  useEffect(() => {
    if (lastChange === 'append' && rows.length > prevCount.current && atBottom.current && !hasNewer) {
      scrollToBottomRobust(rows.length - 1)
    }
    prevCount.current = rows.length
  }, [rows.length, lastChange, hasNewer, scrollToBottomRobust])

  const onScroll = useCallback(
    (offset: number) => {
      const h = handle.current
      if (!h) return
      const remaining = h.scrollSize - offset - h.viewportSize
      atBottom.current = remaining < BOTTOM_THRESHOLD
      if (offset < TOP_THRESHOLD && hasOlder && !loadingOlder) onLoadOlder()
      if (remaining < BOTTOM_THRESHOLD && hasNewer && !loadingNewer) onLoadNewer()
    },
    [hasOlder, loadingOlder, hasNewer, loadingNewer, onLoadOlder, onLoadNewer],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState variant="loading" title="正在读取消息…" description="从本地索引加载最近的聊天记录" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState variant="error" title="消息加载失败" description={error} action={{ label: '重试', onClick: onRetry }} />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {filtered ? (
          <EmptyState variant="no-results" title="没有符合筛选条件的消息" description="换一个日期范围或发送者试试" />
        ) : (
          <EmptyState title="还没有索引到消息" description="同步完成后，这里会显示这个会话的聊天记录" />
        )}
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain py-2" role="log" aria-label="消息流">
      <Virtualizer ref={handle} data={rows} shift={lastChange === 'prepend'} onScroll={onScroll} as={BottomAligned} bufferSize={400} scrollRef={scrollRef}>
        {(row, index) => {
          if (row.kind === 'day') {
            return (
              <div key={row.id}>
                {index === 0 ? <PagingEdge visible={hasOlder} loading={loadingOlder} /> : null}
                <DayPill at={row.at} />
              </div>
            )
          }
          const prev = rows[index - 1]
          const continued = prev?.kind === 'message' && continues(prev.message, row.message)
          return (
            <div key={row.id}>
              {index === 0 ? <PagingEdge visible={hasOlder} loading={loadingOlder} /> : null}
              <MessageRow
                message={row.message}
                isGroup={isGroup}
                selectMode={selectMode}
                selected={selectedIds.has(row.id)}
                focused={flashId === row.id}
                highlight={highlight}
                selfAvatar={selfAvatar}
                senderAvatar={senderAvatars?.get(row.message.senderId) ?? (!isGroup ? peerAvatar : undefined)}
                continued={continued}
                mac={mac}
                {...actions}
              />
              {index === rows.length - 1 ? <PagingEdge visible={hasNewer} loading={loadingNewer} bottom /> : null}
            </div>
          )
        }}
      </Virtualizer>
    </div>
  )
}

function continues(prev: WxMessage, next: WxMessage): boolean {
  return prev.senderId === next.senderId && prev.kind !== 'system' && prev.kind !== 'revoke' && next.kind !== 'system' && next.kind !== 'revoke' && next.createdAt - prev.createdAt < CONTINUE_GAP_MS
}

function PagingEdge({ visible, loading, bottom = false }: { visible: boolean; loading: boolean; bottom?: boolean }) {
  if (!visible) return null
  return (
    <div className={cn('flex h-8 items-center justify-center text-micro text-fg-3', bottom ? 'mt-1' : 'mb-1')}>
      {loading ? <Spinner size={13} /> : bottom ? '向下滚动加载更新的消息' : '向上滚动加载更早的消息'}
    </div>
  )
}
