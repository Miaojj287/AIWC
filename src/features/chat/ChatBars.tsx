/**
 * The three thin bars around the stream: ⌘F search bar (under the header), multi-select bar (top of
 * the stream) and the bottom action bar (全选 / 下载 / 删除 / 引用到 Agent). Figma 149:415 ⑥ ⑦.
 */
import { ArrowDown, ArrowUp, AtSign, Download, Trash, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button, Checkbox, IconButton, SearchBox, Spinner, Tooltip, cn } from '@/kit'

export interface SearchBarProps {
  query: string
  onQueryChange(q: string): void
  onSubmit(q: string): void
  onClose(): void
  searching: boolean
  hitCount: number | undefined
  currentIndex: number
  onPrev(): void
  onNext(): void
}

export function SearchBar({ query, onQueryChange, onSubmit, onClose, searching, hitCount, currentIndex, onPrev, onNext }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const has = hitCount !== undefined
  return (
    <div className="flex h-[40px] shrink-0 items-center gap-2 border-b border-line-6 bg-panel px-4">
      <SearchBox
        ref={inputRef}
        size="sm"
        value={query}
        onValueChange={onQueryChange}
        onSubmit={onSubmit}
        placeholder="搜索这个会话的聊天记录，回车定位"
        wrapperClassName="w-[320px]"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !query) {
            e.preventDefault()
            onClose()
          }
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            onPrev()
          }
        }}
      />
      <span className="min-w-[80px] font-latin text-caption text-fg-3">
        {searching ? <Spinner size={12} /> : has ? (hitCount === 0 ? '无结果' : `${currentIndex + 1} / ${hitCount}`) : ''}
      </span>
      <Tooltip content="上一条" kbd="⇧↵">
        <IconButton size="sm" icon={ArrowUp} label="上一条" disabled={!has || hitCount === 0} onClick={onPrev} />
      </Tooltip>
      <Tooltip content="下一条" kbd="↵">
        <IconButton size="sm" icon={ArrowDown} label="下一条" disabled={!has || hitCount === 0} onClick={onNext} />
      </Tooltip>
      <span className="flex-1" />
      <IconButton size="sm" icon={X} label="关闭搜索" onClick={onClose} />
    </div>
  )
}

export interface SelectionBarProps {
  count: number
  onQuote(): void
  onExport(): void
  onDelete(): void
  onCancel(): void
}

export function SelectionBar({ count, onQuote, onExport, onDelete, onCancel }: SelectionBarProps) {
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-1 border-b border-accent/20 bg-accent-12 px-4">
      <span className="mr-2 text-caption font-medium text-accent">已选 {count} 条</span>
      <Button variant="link" size="sm" icon={AtSign} onClick={onQuote} disabled={count === 0}>
        引用到 Agent
      </Button>
      <Button variant="link" size="sm" icon={Download} onClick={onExport} disabled={count === 0} className="text-fg-2 hover:text-fg">
        下载
      </Button>
      <Button variant="link" size="sm" icon={Trash} onClick={onDelete} disabled={count === 0} className="text-fg-2 hover:text-danger">
        删除
      </Button>
      <span className="flex-1" />
      <Button variant="link" size="sm" onClick={onCancel} className="text-fg-2 hover:text-fg">
        取消
      </Button>
    </div>
  )
}

export interface BottomBarProps {
  allState: boolean | 'indeterminate'
  onToggleAll(next: boolean): void
  onExport(): void
  onDelete(): void
  onQuote(): void
  disabled: boolean
  selectedCount: number
}

export function BottomBar({ allState, onToggleAll, onExport, onDelete, onQuote, disabled, selectedCount }: BottomBarProps) {
  return (
    <div className={cn('flex h-[44px] shrink-0 items-center gap-1 border-t border-line-6 px-4')}>
      <Checkbox checked={allState} onCheckedChange={(c) => onToggleAll(c === true)} disabled={disabled} label="全选" className="mr-2 items-center" />
      <Button variant="link" size="sm" icon={Download} onClick={onExport} disabled={disabled} className="text-fg-2 hover:text-fg">
        下载
      </Button>
      <Button variant="link" size="sm" icon={Trash} onClick={onDelete} disabled={disabled} className="text-fg-2 hover:text-danger">
        删除
      </Button>
      <span className="flex-1" />
      <Button variant="link" size="sm" icon={AtSign} onClick={onQuote} disabled={disabled}>
        {selectedCount > 0 ? `引用 ${selectedCount} 条到 Agent` : '引用到 Agent'}
      </Button>
    </div>
  )
}
