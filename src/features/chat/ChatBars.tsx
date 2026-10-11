/**
 * The three thin bars around the stream: ⌘F search bar (under the header), multi-select bar (top of
 * the stream) and the bottom action bar (全选 / 下载 / 删除 / 引用到 Agent). Figma 149:415 ⑥ ⑦.
 */
import { ArrowDown, ArrowUp, AtSign, Copy, Download, Trash, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button, Checkbox, IconButton, SearchBox, Spinner, Tooltip } from '@/kit'
import { useT } from '@/i18n'
import { detectMac, formatShortcut } from '@/app/shortcuts'

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

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  onClose,
  searching,
  hitCount,
  currentIndex,
  onPrev,
  onNext,
}: SearchBarProps) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const has = hitCount !== undefined
  // ⇧↵ on macOS, Shift+Enter elsewhere: the same table formats every shortcut label.
  const mac = detectMac()
  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-line-6 bg-panel px-4">
      <SearchBox
        ref={inputRef}
        size="sm"
        value={query}
        onValueChange={onQueryChange}
        onSubmit={onSubmit}
        placeholder={t('chat.searchBar.placeholder')}
        wrapperClassName="min-w-0 max-w-[320px] flex-1"
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
      <span role="status" className="shrink-0 font-latin text-caption tabular-nums text-fg-3">
        {searching ? (
          <Spinner size={12} />
        ) : has ? (
          hitCount === 0 ? (
            t('chat.searchBar.noResults')
          ) : (
            `${currentIndex + 1} / ${hitCount}`
          )
        ) : (
          ''
        )}
      </span>
      <Tooltip
        content={t('chat.searchBar.previous')}
        kbd={formatShortcut({ key: 'enter', mod: false, shift: true }, mac)}
      >
        <IconButton
          size="sm"
          className="shrink-0"
          icon={ArrowUp}
          label={t('chat.searchBar.previous')}
          disabled={!has || hitCount === 0}
          onClick={onPrev}
        />
      </Tooltip>
      <Tooltip content={t('chat.searchBar.next')} kbd={formatShortcut({ key: 'enter', mod: false }, mac)}>
        <IconButton
          size="sm"
          className="shrink-0"
          icon={ArrowDown}
          label={t('chat.searchBar.next')}
          disabled={!has || hitCount === 0}
          onClick={onNext}
        />
      </Tooltip>
      <IconButton size="sm" className="ml-auto shrink-0" icon={X} label={t('chat.searchBar.close')} onClick={onClose} />
    </div>
  )
}

export interface SelectionBarProps {
  count: number
  onQuote(): void
  onCopy(): void
  onExport(): void
  onCancel(): void
}

export function SelectionBar({ count, onQuote, onCopy, onExport, onCancel }: SelectionBarProps) {
  const t = useT()
  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-accent-30 bg-accent-12 px-4">
      <span className="mr-2 shrink-0 text-caption font-medium text-accent-ink">
        {t('chat.selectionBar.selected', { n: count })}
      </span>
      <Button variant="link" size="sm" icon={AtSign} onClick={onQuote} disabled={count === 0}>
        {t('chat.actions.quoteToAgent')}
      </Button>
      <Button
        variant="link"
        size="sm"
        icon={Copy}
        onClick={onCopy}
        disabled={count === 0}
        className="text-fg-2 hover:text-fg"
      >
        {t('common.copy')}
      </Button>
      <Button
        variant="link"
        size="sm"
        icon={Download}
        onClick={onExport}
        disabled={count === 0}
        className="text-fg-2 hover:text-fg"
      >
        {t('chat.actions.download')}
      </Button>
      <Button
        variant="link"
        size="sm"
        icon={Trash}
        disabled
        disabledReason={t('chat.deleteUnsupported')}
        className="text-fg-2"
      >
        {t('common.delete')}
      </Button>
      <span className="flex-1" />
      <Button variant="link" size="sm" onClick={onCancel} className="text-fg-2 hover:text-fg">
        {t('common.cancel')}
      </Button>
    </div>
  )
}

export interface BottomBarProps {
  allState: boolean | 'indeterminate'
  onToggleAll(next: boolean): void
  onExport(): void
  onQuote(): void
  disabled: boolean
  selectedCount: number
}

export function BottomBar({ allState, onToggleAll, onExport, onQuote, disabled, selectedCount }: BottomBarProps) {
  const t = useT()
  return (
    <div className="flex h-11 min-w-0 shrink-0 items-center gap-1 border-t border-line-6 px-4">
      <Checkbox
        checked={allState}
        onCheckedChange={(c) => onToggleAll(c === true)}
        disabled={disabled}
        label={t('chat.bottomBar.selectAll')}
        className="mr-2 items-center"
      />
      <Button
        variant="link"
        size="sm"
        icon={Download}
        onClick={onExport}
        disabled={disabled}
        className="text-fg-2 hover:text-fg"
      >
        {t('chat.actions.download')}
      </Button>
      <Button
        variant="link"
        size="sm"
        icon={Trash}
        disabled
        disabledReason={t('chat.deleteUnsupported')}
        className="text-fg-2"
      >
        {t('common.delete')}
      </Button>
      <span className="flex-1" />
      <Button variant="link" size="sm" icon={AtSign} onClick={onQuote} disabled={disabled}>
        {selectedCount > 0 ? t('chat.bottomBar.quoteSelected', { n: selectedCount }) : t('chat.actions.quoteToAgent')}
      </Button>
    </div>
  )
}
