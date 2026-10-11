/**
 * 设置 › 扩展 › MCP 服务器: one setting row per server (name + status badge, where it runs, enable toggle, ··· and the
 * same right-click menu), live status from `mcp:status`, the add / edit dialog, the tools dialog and the delete
 * confirmation. Every list state is covered: loading, error with retry, empty.
 */
import { Ellipsis, Pencil, Plus, RotateCw, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { McpServerStatus, McpServerView } from '@aiwc/protocol'
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
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import { Section } from '../../pageKit'
import { MCP_ERROR_LABEL, serverTarget, statusBadge, TRANSPORT_LABEL } from '../../extensionsModel'
import { McpServerDialog } from './McpServerDialog'
import { McpToolsDialog } from './McpToolsDialog'

export function McpSection() {
  const t = useT()
  const list = useInvoke('mcp:list', undefined, [])
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [editing, setEditing] = useState<McpServerView | 'new' | null>(null)
  const [toolsOf, setToolsOf] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<McpServerView | null>(null)
  const [restarting, setRestarting] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, McpServerView>>({})

  useBridgeEvent('mcp:status', (status) => setStatuses((prev) => ({ ...prev, [status.id]: status })))

  const servers = (list.data ?? []).map((server) => {
    const latest = overrides[server.id] ?? server
    const status = statuses[server.id]
    return status && status.updatedAt >= latest.status.updatedAt ? { ...latest, status } : latest
  })
  const takenIds = servers.map((s) => s.id)

  const refresh = (): void => {
    setOverrides({})
    list.reload()
  }
  const replace = (view: McpServerView): void => setOverrides((prev) => ({ ...prev, [view.id]: view }))

  const setEnabled = async (server: McpServerView, enabled: boolean) => {
    try {
      replace(await invoke('mcp:setEnabled', { id: server.id, enabled }))
    } catch (e) {
      toast.error(t('settings.extensions.mcp.updateFailed'), { detail: errorMessage(e) })
    }
  }
  const restart = async (server: McpServerView) => {
    setRestarting(server.id)
    try {
      const view = await invoke('mcp:restart', { id: server.id })
      replace(view)
      setStatuses((prev) => ({ ...prev, [view.id]: view.status }))
      if (view.status.state === 'ready') toast.success(t('settings.extensions.mcp.restarted', { name: server.label }))
    } catch (e) {
      toast.error(t('settings.extensions.mcp.restartFailed'), { detail: errorMessage(e) })
    } finally {
      setRestarting(null)
    }
  }
  const remove = async (server: McpServerView) => {
    try {
      await invoke('mcp:remove', { id: server.id })
      toast.success(t('settings.extensions.mcp.deleted', { name: server.label }))
      refresh()
    } catch (e) {
      toast.error(t('settings.extensions.mcp.updateFailed'), { detail: errorMessage(e) })
    }
  }

  const menuFor = (server: McpServerView): MenuSpec => [
    { id: 'edit', label: t('settings.extensions.mcp.menu.edit'), icon: Pencil, onSelect: () => setEditing(server) },
    {
      id: 'tools',
      label: t('settings.extensions.mcp.menu.tools'),
      icon: Wrench,
      onSelect: () => setToolsOf(server.id),
    },
    {
      id: 'restart',
      label: t('settings.extensions.mcp.menu.restart'),
      icon: RotateCw,
      disabled: !server.enabled,
      onSelect: () => void restart(server),
    },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('settings.extensions.mcp.menu.delete'),
      icon: Trash2,
      danger: true,
      onSelect: () => setDeleting(server),
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
          title={t('settings.extensions.mcp.loadFailed')}
          description={list.error.message}
          action={{ label: t('settings.extensions.mcp.retry'), onClick: refresh }}
        />
      )
    if (servers.length === 0)
      return (
        <EmptyState
          compact
          bordered
          title={t('settings.extensions.mcp.empty.title')}
          description={t('settings.extensions.mcp.empty.description')}
          action={{ label: t('settings.extensions.mcp.add'), onClick: () => setEditing('new') }}
        />
      )
    return (
      <Card variant="rows">
        {servers.map((server) => {
          const badge = statusBadge(server.status)
          const error = server.status.state === 'error' ? server.status : undefined
          return (
            <ContextMenu key={server.id}>
              <ContextMenuTrigger asChild>
                <SettingRow
                  title={server.label}
                  badge={
                    <Badge tone={badge.tone}>
                      {badge.n === undefined ? t(badge.key) : t(badge.key, { n: badge.n })}
                    </Badge>
                  }
                  description={
                    <span className="block truncate font-mono" title={serverTarget(server)}>
                      {t(TRANSPORT_LABEL[server.transport])} · {serverTarget(server)}
                    </span>
                  }
                >
                  <Toggle
                    checked={server.enabled}
                    onCheckedChange={(on) => void setEnabled(server, on)}
                    label={t('settings.extensions.mcp.toggle', { name: server.label })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        icon={Ellipsis}
                        size="sm"
                        loading={restarting === server.id}
                        label={t('settings.extensions.mcp.more', { name: server.label })}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItems items={menuFor(server)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {error ? (
                    <InlineHint kind="error" live={false} truncate className="basis-full">
                      {error.errorCode
                        ? t('settings.extensions.mcp.errorLine', {
                            reason: t(MCP_ERROR_LABEL[error.errorCode]),
                            detail: error.error ?? '',
                          })
                        : (error.error ?? t('settings.extensions.mcp.status.error'))}
                    </InlineHint>
                  ) : null}
                </SettingRow>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItems items={menuFor(server)} />
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </Card>
    )
  })()

  const toolsServer = servers.find((s) => s.id === toolsOf)

  return (
    <Section
      id="extensions.mcp"
      title={t('settings.extensions.sections.mcp')}
      help={t('settings.extensions.mcp.help')}
      actions={
        <Button variant="outline" size="sm" icon={Plus} onClick={() => setEditing('new')}>
          {t('settings.extensions.mcp.add')}
        </Button>
      }
    >
      {body}
      {editing ? (
        <McpServerDialog
          server={editing === 'new' ? undefined : editing}
          takenIds={takenIds}
          onClose={() => setEditing(null)}
          onSaved={(view) => {
            setEditing(null)
            replace(view)
            refresh()
          }}
        />
      ) : null}
      {toolsServer ? (
        <McpToolsDialog server={toolsServer} onClose={() => setToolsOf(null)} onChanged={replace} />
      ) : null}
      <DangerDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('settings.extensions.mcp.deleteTitle', { name: deleting?.label ?? '' })}
        description={t('settings.extensions.mcp.deleteDescription')}
        confirmLabel={t('settings.extensions.mcp.deleteConfirm')}
        onConfirm={async () => {
          const target = deleting
          setDeleting(null)
          if (target) await remove(target)
        }}
      />
    </Section>
  )
}
