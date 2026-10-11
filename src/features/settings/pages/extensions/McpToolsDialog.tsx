/**
 * 工具与权限 of one MCP server: each tool's access (server default or a per-tool override) and whether the Agent gets
 * it at all. A destructive hint from the server is shown and always asks: such a tool has no access choice to lower.
 */
import { Wrench } from 'lucide-react'
import { useState } from 'react'
import type { McpServerView, McpToolRisk, McpToolView } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Select,
  SettingRow,
  toast,
  Toggle,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import { MCP_RISKS, RISK_DESCRIPTION, RISK_LABEL } from '../../extensionsModel'

const DEFAULT = 'default'
type RiskChoice = McpToolRisk | typeof DEFAULT

/** Mirrors main's rule (mcp/tools.ts): declared destructive and not also read-only = always destructive. */
const isDestructive = (tool: McpToolView): boolean =>
  tool.declaredDestructive === true && tool.declaredReadOnly !== true

export interface McpToolsDialogProps {
  server: McpServerView
  onClose(): void
  onChanged(view: McpServerView): void
}

export function McpToolsDialog({ server, onClose, onChanged }: McpToolsDialogProps) {
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)

  const update = async (tool: McpToolView, patch: { risk?: McpToolRisk | null; disabled?: boolean }) => {
    setBusy(tool.name)
    try {
      onChanged(await invoke('mcp:setToolPolicy', { id: server.id, tool: tool.name, ...patch }))
    } catch (e) {
      toast.error(t('settings.extensions.mcp.updateFailed'), { detail: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const options = [
    { value: DEFAULT, label: t('settings.extensions.risk.useDefault', { risk: t(RISK_LABEL[server.defaultRisk]) }) },
    ...MCP_RISKS.map((risk) => ({ value: risk, label: t(RISK_LABEL[risk]), description: t(RISK_DESCRIPTION[risk]) })),
  ] satisfies Array<{ value: RiskChoice; label: string; description?: string }>

  const tools = server.status.tools
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader
          icon={Wrench}
          title={t('settings.extensions.mcp.tools.title', { name: server.label })}
          description={t('settings.extensions.mcp.tools.description')}
        />
        <DialogBody className="max-h-[60vh]">
          {server.status.state !== 'ready' ? (
            <EmptyState compact title={t('settings.extensions.mcp.tools.notReady')} />
          ) : tools.length === 0 ? (
            <EmptyState compact title={t('settings.extensions.mcp.tools.empty')} />
          ) : (
            <Card variant="rows">
              {tools.map((tool) => (
                <SettingRow
                  key={tool.name}
                  title={<span className="font-mono">{tool.name}</span>}
                  badge={
                    isDestructive(tool) ? (
                      <Badge tone="danger">{t('settings.extensions.risk.destructive')}</Badge>
                    ) : undefined
                  }
                  description={
                    <span className="line-clamp-2" title={tool.description}>
                      {isDestructive(tool)
                        ? t('settings.extensions.mcp.tools.declaredDestructive')
                        : tool.description ||
                          (tool.declaredReadOnly ? t('settings.extensions.mcp.tools.declaredReadOnly') : '')}
                    </span>
                  }
                >
                  {isDestructive(tool) ? null : (
                    <Select<RiskChoice>
                      aria-label={t('settings.extensions.mcp.tools.risk', { tool: tool.name })}
                      options={options}
                      value={tool.override ?? DEFAULT}
                      disabled={busy === tool.name}
                      align="end"
                      onValueChange={(value) => void update(tool, { risk: value === DEFAULT ? null : value })}
                    />
                  )}
                  <Toggle
                    checked={!tool.disabled}
                    disabled={busy === tool.name}
                    label={t('settings.extensions.mcp.tools.enable', { tool: tool.name })}
                    onCheckedChange={(on) => void update(tool, { disabled: !on })}
                  />
                </SettingRow>
              ))}
            </Card>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            {t('settings.extensions.mcp.tools.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
