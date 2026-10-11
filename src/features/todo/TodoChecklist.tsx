/**
 * The 每日待办 checklist, notes-style: a round check per item, click the text to edit it in place,
 * a 新待办 line on top (Enter adds and stays there for the next one), checked items drop into a
 * collapsible 已完成 group with 清除已完成. Delete is immediate with 撤销 on the toast; hover shows
 * 在聊天中查看 / 删除, right-click shows the same actions in the usual order.
 */
import { Check, ChevronDown, ChevronRight, MessageSquare, Pencil, Plus, RotateCcw, Trash } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { TodoItem } from '@aiwc/protocol'
import { TODO_TEXT_MAX } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  EmptyState,
  ICON_STROKE,
  IconButton,
  Input,
  cn,
  type MenuSpec,
} from '@/kit'
import { formatClock } from '@/platform/format'
import { scanTime } from './todoModel'
import { addTodo, clearDoneTodos, editTodo, removeTodo, setTodoDone } from './todoStore'

export interface TodoChecklistProps {
  open: TodoItem[]
  done: TodoItem[]
  /** Show each item's chat (the unfiltered dashboard); a dashboard narrowed to one chat hides it. */
  showSource: boolean
  /** Typed items have no chat, so the narrowed dashboard does not offer the 新待办 line. */
  canAdd: boolean
}

export function TodoChecklist({ open, done, showSource, canAdd }: TodoChecklistProps) {
  const t = useT()
  const [showDone, setShowDone] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <section className="flex flex-col gap-3" aria-labelledby="todo-open-heading">
      <div className="flex items-baseline gap-2 px-1">
        <h2 id="todo-open-heading" className="text-body font-semibold text-fg">
          {t('todo.list.openHeading')}
        </h2>
        <span className="text-caption text-fg-3">{open.length}</span>
      </div>
      <div className="flex flex-col rounded-card border border-line-6 bg-panel p-1.5" role="list">
        {canAdd ? <NewTodoLine /> : null}
        {open.map((item) => (
          <TodoRow key={item.id} item={item} showSource={showSource} />
        ))}
        {open.length === 0 ? (
          <EmptyState
            compact
            icon={Check}
            title={t('todo.list.allDone')}
            description={done.length > 0 ? t('todo.list.allDoneHint', { n: done.length }) : undefined}
            className="py-6"
          />
        ) : null}
      </div>

      {done.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
              className="flex min-w-0 items-center gap-1 rounded-control py-1 text-caption font-medium text-fg-3 hover:text-fg-2"
            >
              {showDone ? (
                <ChevronDown size={13} strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <ChevronRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
              )}
              <span className="truncate">{t('todo.list.doneHeading', { n: done.length })}</span>
            </button>
            <span className="flex-1" />
            <Button variant="link" size="sm" onClick={() => setConfirmClear(true)}>
              {t('todo.list.clearDone')}
            </Button>
          </div>
          {showDone ? (
            <div className="flex flex-col rounded-card border border-line-6 bg-panel p-1.5" role="list">
              {done.map((item) => (
                <TodoRow key={item.id} item={item} showSource={showSource} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <DangerDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('todo.list.clearConfirm.title', { n: done.length })}
        description={t('todo.list.clearConfirm.description')}
        confirmLabel={t('todo.list.clearDone')}
        onConfirm={async () => {
          setConfirmClear(false)
          await clearDoneTodos()
        }}
      />
    </section>
  )
}

function NewTodoLine() {
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    const ok = await addTodo(text)
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <div role="listitem" className="flex items-center gap-3 rounded-item px-2.5 py-1.5">
      <Plus size={18} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      <Input
        size="sm"
        aria-label={t('todo.item.newLabel')}
        placeholder={t('todo.item.newPlaceholder')}
        value={text}
        maxLength={TODO_TEXT_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        className="border-transparent bg-transparent px-0"
      />
    </div>
  )
}

function TodoRow({ item, showSource }: { item: TodoItem; showSource: boolean }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const jump = item.sourceId
    ? () =>
        runCommand('tab.openChat', {
          sessionId: item.sourceId as string,
          title: item.sourceTitle ?? item.sourceId ?? '',
          ...(item.messageId ? { focusMessageId: item.messageId } : {}),
        })
    : undefined
  const menu: MenuSpec = [
    item.done
      ? { id: 'undone', label: t('todo.item.markOpen'), icon: RotateCcw, onSelect: () => void setTodoDone(item, false) }
      : { id: 'done', label: t('todo.item.markDone'), icon: Check, onSelect: () => void setTodoDone(item, true) },
    { id: 'edit', label: t('todo.item.edit'), icon: Pencil, onSelect: () => setEditing(true) },
    ...(jump
      ? ([
          { type: 'separator' },
          { id: 'chat', label: t('todo.item.viewInChat'), icon: MessageSquare, onSelect: jump },
        ] satisfies MenuSpec)
      : []),
    { type: 'separator' },
    { id: 'delete', label: t('todo.item.delete'), icon: Trash, danger: true, onSelect: () => void removeTodo(item) },
  ]
  const meta = [
    showSource && item.sourceTitle ? item.sourceTitle : undefined,
    item.origin === 'user' ? t('todo.item.typed') : undefined,
    scanTime(item.done && item.doneAt ? item.doneAt : (item.messageAt ?? item.createdAt), t, formatClock),
  ].filter((part): part is string => Boolean(part))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="listitem"
          className="group flex items-start gap-3 rounded-item px-2.5 py-2 hover:bg-hover-5"
          data-done={item.done || undefined}
        >
          <Checkbox
            shape="round"
            className="mt-px"
            checked={item.done}
            aria-label={t(item.done ? 'todo.item.markOpenLabel' : 'todo.item.markDoneLabel', { text: item.text })}
            onCheckedChange={(checked) => void setTodoDone(item, checked === true)}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {editing ? (
              <EditField item={item} onDone={() => setEditing(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title={t('todo.item.editHint')}
                className={cn(
                  'min-w-0 cursor-text break-words rounded-control text-left text-body leading-5',
                  item.done ? 'text-fg-3 line-through' : 'text-fg',
                )}
              >
                {item.text}
              </button>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption leading-4 text-fg-3">
              {item.due && !item.done ? <Badge tone="warn">{item.due}</Badge> : null}
              <span className="min-w-0 truncate" title={meta.join(' · ')}>
                {meta.join(' · ')}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            {jump ? (
              <IconButton size="sm" icon={MessageSquare} label={t('todo.item.viewInChat')} onClick={jump} />
            ) : null}
            <IconButton size="sm" icon={Trash} label={t('todo.item.delete')} onClick={() => void removeTodo(item)} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function EditField({ item, onDone }: { item: TodoItem; onDone: () => void }) {
  const t = useT()
  const [text, setText] = useState(item.text)
  /** Set once Enter / Escape has handled the edit, so the blur that follows does not save again. */
  const settled = useRef(false)
  const commit = async () => {
    if (settled.current) return
    settled.current = true
    if (text.trim() && text.trim() !== item.text) await editTodo(item, text)
    onDone()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      settled.current = true
      onDone()
    }
  }
  return (
    <Input
      size="sm"
      autoFocus
      aria-label={t('todo.item.editLabel')}
      value={text}
      maxLength={TODO_TEXT_MAX}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => void commit()}
    />
  )
}
