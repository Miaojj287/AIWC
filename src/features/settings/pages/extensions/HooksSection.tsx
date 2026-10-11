/**
 * 设置 › 扩展 › Hooks: the standing warning that hooks run local commands (CLAUDE.md §6), one setting row per hook
 * (event · matcher · sandbox, the command, last run), enable toggle, ··· / right-click menu (edit, test run, delete),
 * and the test-run result.
 */
import { Ellipsis, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { UserHookTestResult, UserHookView } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  InlineHint,
  SettingRow,
  SkeletonListRows,
  toast,
  Toggle,
  type MenuSpec,
} from '@/kit'
import { formatRelative } from '@/platform/format'
import { invoke, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import { Section } from '../../pageKit'
import { HOOK_EVENT_LABEL, isToolEvent, OUTCOME_HINT, OUTCOME_LABEL } from '../../extensionsModel'
import { HookDialog } from './HookDialog'

export function HooksSection() {
  const t = useT()
  const list = useInvoke('hooks:list', undefined, [])
  const [editing, setEditing] = useState<UserHookView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<UserHookView | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [result, setResult] = useState<{ hook: UserHookView; result: UserHookTestResult } | null>(null)

  const hooks = list.data?.hooks ?? []
  const sandbox = list.data?.sandbox ?? false
  const nameOf = (hook: UserHookView) => hook.label || t(HOOK_EVENT_LABEL[hook.event])

  const setEnabled = async (hook: UserHookView, enabled: boolean) => {
    try {
      await invoke('hooks:setEnabled', { id: hook.id, enabled })
      list.reload()
    } catch (e) {
      toast.error(t('settings.extensions.hooks.updateFailed'), { detail: errorMessage(e) })
    }
  }
  const test = async (hook: UserHookView) => {
    setTesting(hook.id)
    try {
      setResult({ hook, result: await invoke('hooks:test', { id: hook.id }) })
      list.reload()
    } catch (e) {
      toast.error(t('settings.extensions.hooks.testFailed'), { detail: errorMessage(e) })
    } finally {
      setTesting(null)
    }
  }
  const remove = async (hook: UserHookView) => {
    try {
      await invoke('hooks:remove', { id: hook.id })
      toast.success(t('settings.extensions.hooks.deleted'))
      list.reload()
    } catch (e) {
      toast.error(t('settings.extensions.hooks.updateFailed'), { detail: errorMessage(e) })
    }
  }

  const menuFor = (hook: UserHookView): MenuSpec => [
    { id: 'edit', label: t('settings.extensions.hooks.menu.edit'), icon: Pencil, onSelect: () => setEditing(hook) },
    {
      id: 'test',
      label: t('settings.extensions.hooks.menu.test'),
      icon: FlaskConical,
      onSelect: () => void test(hook),
    },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('settings.extensions.hooks.menu.delete'),
      icon: Trash2,
      danger: true,
      onSelect: () => setDeleting(hook),
    },
  ]

  const body = (() => {
    if (list.loading && !list.data) return <SkeletonListRows rows={2} avatar={false} />
    if (list.error && !list.data)
      return (
        <EmptyState
          variant="error"
          compact
          bordered
          title={t('settings.extensions.hooks.loadFailed')}
          description={list.error.message}
          action={{ label: t('settings.extensions.mcp.retry'), onClick: list.reload }}
        />
      )
    if (hooks.length === 0)
      return (
        <EmptyState
          compact
          bordered
          title={t('settings.extensions.hooks.empty.title')}
          description={t('settings.extensions.hooks.empty.description')}
          action={{ label: t('settings.extensions.hooks.add'), onClick: () => setEditing('new') }}
        />
      )
    return (
      <Card variant="rows">
        {hooks.map((hook) => {
          const scope = isToolEvent(hook.event)
            ? hook.matcher && hook.matcher !== '*'
              ? t('settings.extensions.hooks.matcher', { matcher: hook.matcher })
              : t('settings.extensions.hooks.matcherAll')
            : undefined
          return (
            <ContextMenu key={hook.id}>
              <ContextMenuTrigger asChild>
                <SettingRow
                  title={nameOf(hook)}
                  badge={
                    <Badge tone={hook.sandbox && sandbox ? 'neutral' : 'warn'}>
                      {hook.sandbox && sandbox
                        ? t('settings.extensions.hooks.sandboxed')
                        : t('settings.extensions.hooks.unsandboxed')}
                    </Badge>
                  }
                  description={
                    <span className="flex min-w-0 flex-col">
                      <span className="block truncate">
                        {/* An unnamed hook is titled by its event already. */}
                        {[hook.label ? t(HOOK_EVENT_LABEL[hook.event]) : undefined, scope].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block truncate font-mono" title={hook.command}>
                        {hook.command}
                      </span>
                    </span>
                  }
                >
                  <Toggle
                    checked={hook.enabled}
                    onCheckedChange={(on) => void setEnabled(hook, on)}
                    label={t('settings.extensions.hooks.toggle', { name: nameOf(hook) })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        icon={Ellipsis}
                        size="sm"
                        loading={testing === hook.id}
                        label={t('settings.extensions.hooks.more', { name: nameOf(hook) })}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItems items={menuFor(hook)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {hook.lastRun ? (
                    <InlineHint kind={OUTCOME_HINT[hook.lastRun.outcome]} live={false} truncate className="basis-full">
                      {t('settings.extensions.hooks.lastRun', {
                        outcome: t(OUTCOME_LABEL[hook.lastRun.outcome]),
                        time: formatRelative(hook.lastRun.at),
                      })}
                      {hook.lastRun.message ? ` · ${hook.lastRun.message}` : ''}
                    </InlineHint>
                  ) : null}
                </SettingRow>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menuFor(hook)} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </Card>
    )
  })()

  return (
    <Section
      id="extensions.hooks"
      title={t('settings.extensions.sections.hooks')}
      help={t('settings.extensions.hooks.help')}
      actions={
        <Button variant="outline" size="sm" icon={Plus} onClick={() => setEditing('new')}>
          {t('settings.extensions.hooks.add')}
        </Button>
      }
    >
      {body}
      {editing ? (
        <HookDialog
          hook={editing === 'new' ? undefined : editing}
          sandboxAvailable={sandbox}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      ) : null}
      <DangerDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('settings.extensions.hooks.deleteTitle', { name: deleting ? nameOf(deleting) : '' })}
        description={t('settings.extensions.hooks.deleteDescription')}
        confirmLabel={t('settings.extensions.hooks.deleteConfirm')}
        onConfirm={async () => {
          const target = deleting
          setDeleting(null)
          if (target) await remove(target)
        }}
      />
      {result ? <HookTestDialog {...result} onClose={() => setResult(null)} /> : null}
    </Section>
  )
}

function HookTestDialog({
  hook,
  result,
  onClose,
}: {
  hook: UserHookView
  result: UserHookTestResult
  onClose(): void
}) {
  const t = useT()
  const block = (label: string, text: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-micro font-medium text-fg-3">{label}</span>
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-item bg-line-4 px-2.5 py-2 font-mono text-micro leading-4 text-fg-2 select-text">
        {text.trim() || t('settings.extensions.hooks.test.none')}
      </pre>
    </div>
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader
          icon={FlaskConical}
          title={t('settings.extensions.hooks.test.title')}
          description={t('settings.extensions.hooks.test.description', { event: t(HOOK_EVENT_LABEL[hook.event]) })}
        />
        <DialogBody>
          <InlineHint kind={OUTCOME_HINT[result.outcome]} live={false}>
            {t('settings.extensions.hooks.test.summary', {
              outcome: t(OUTCOME_LABEL[result.outcome]),
              code: result.exitCode === null ? '—' : String(result.exitCode),
            })}
            {result.message ? ` · ${result.message}` : ''}
          </InlineHint>
          {block(t('settings.extensions.hooks.test.stdout'), result.stdout)}
          {block(t('settings.extensions.hooks.test.stderr'), result.stderr)}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            {t('settings.extensions.hooks.test.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
