/**
 * 设置 › 扩展 view model: MCP server and hook forms (renderer state ↔ IPC drafts), their inline validation, and the
 * copy keys for statuses, risks and events. Pure — the page and its dialogs only render what this returns. Main
 * validates again; this is for inline errors before the user presses 保存 (CLAUDE.md §4.6).
 */
import {
  compileHookMatcher,
  isAllowedMcpUrl,
  isReservedMcpEnvName,
  MCP_SECRET_NAME_PATTERN,
  MCP_SERVER_ID_PATTERN,
  TOOL_HOOK_EVENTS,
  type McpErrorCode,
  type McpServerDraft,
  type McpServerStatus,
  type McpServerView,
  type McpToolRisk,
  type McpTransport,
  type UserHookDraft,
  type UserHookEvent,
  type UserHookOutcome,
  type UserHookView,
} from '@aiwc/protocol'
import type { MessageKey } from '@/i18n'

export const MCP_RISKS: readonly McpToolRisk[] = ['read', 'write', 'send']

export const RISK_LABEL: Record<McpToolRisk | 'destructive', MessageKey> = {
  read: 'settings.extensions.risk.read',
  write: 'settings.extensions.risk.write',
  send: 'settings.extensions.risk.send',
  destructive: 'settings.extensions.risk.destructive',
}
export const RISK_DESCRIPTION: Record<McpToolRisk, MessageKey> = {
  read: 'settings.extensions.risk.readDesc',
  write: 'settings.extensions.risk.writeDesc',
  send: 'settings.extensions.risk.sendDesc',
}

export const TRANSPORT_LABEL: Record<McpTransport, MessageKey> = {
  stdio: 'settings.extensions.mcp.transport.stdio',
  http: 'settings.extensions.mcp.transport.http',
  sse: 'settings.extensions.mcp.transport.sse',
}

export const MCP_ERROR_LABEL: Record<McpErrorCode, MessageKey> = {
  spawn_failed: 'settings.extensions.mcp.error.spawn_failed',
  exited: 'settings.extensions.mcp.error.exited',
  timeout: 'settings.extensions.mcp.error.timeout',
  http: 'settings.extensions.mcp.error.http',
  protocol: 'settings.extensions.mcp.error.protocol',
  missing_secret: 'settings.extensions.mcp.error.missing_secret',
}

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent'

export function statusBadge(status: McpServerStatus): { tone: BadgeTone; key: MessageKey; n?: number } {
  switch (status.state) {
    case 'ready':
      return {
        tone: 'ok',
        key: 'settings.extensions.mcp.status.ready',
        n: status.tools.filter((tool) => !tool.disabled).length,
      }
    case 'connecting':
      return { tone: 'accent', key: 'settings.extensions.mcp.status.connecting' }
    case 'error':
      return { tone: 'danger', key: 'settings.extensions.mcp.status.error' }
    case 'disabled':
      return { tone: 'neutral', key: 'settings.extensions.mcp.status.disabled' }
  }
}

/** One line under the server name: where it runs. */
export function serverTarget(server: Pick<McpServerView, 'transport' | 'command' | 'args' | 'url'>): string {
  return server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url
}

// --------------------------------------------------------------------------------------------- MCP form

export interface SecretField {
  name: string
  /** New value typed by the user; empty = keep the stored one. */
  value: string
  stored: boolean
}

export interface McpForm {
  originalId?: string
  id: string
  label: string
  enabled: boolean
  transport: McpTransport
  command: string
  /** One argument per line, so no shell quoting rules apply. */
  args: string
  cwd: string
  url: string
  secrets: SecretField[]
  defaultRisk: McpToolRisk
  timeoutSec: string
  toolRisk: Record<string, McpToolRisk>
  disabledTools: string[]
}

const DEFAULT_TIMEOUT_SEC = 120

export function blankMcpForm(): McpForm {
  return {
    id: '',
    label: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: '',
    cwd: '',
    url: '',
    secrets: [],
    defaultRisk: 'write',
    timeoutSec: String(DEFAULT_TIMEOUT_SEC),
    toolRisk: {},
    disabledTools: [],
  }
}

export function mcpFormFromView(view: McpServerView): McpForm {
  return {
    originalId: view.id,
    id: view.id,
    label: view.label,
    enabled: view.enabled,
    transport: view.transport,
    command: view.command,
    args: view.args.join('\n'),
    cwd: view.cwd ?? '',
    url: view.url,
    secrets: view.secrets.map((s) => ({ name: s.name, value: '', stored: s.hasValue })),
    defaultRisk: view.defaultRisk,
    timeoutSec: String(Math.round(view.timeoutMs / 1000)),
    toolRisk: { ...view.toolRisk },
    disabledTools: [...view.disabledTools],
  }
}

/** A tool-name-safe id from the label (`GitHub Issues` → `github_issues`). */
export function suggestServerId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  return /^[a-z]/.test(slug) ? slug : slug ? `s_${slug}`.slice(0, 20) : ''
}

export type McpFormField = 'id' | 'label' | 'command' | 'cwd' | 'url' | 'secrets' | 'timeout'

export function validateMcpForm(form: McpForm, takenIds: readonly string[]): Partial<Record<McpFormField, MessageKey>> {
  const errors: Partial<Record<McpFormField, MessageKey>> = {}
  if (!form.label.trim()) errors.label = 'settings.extensions.mcp.form.errors.label'
  if (!MCP_SERVER_ID_PATTERN.test(form.id)) errors.id = 'settings.extensions.mcp.form.errors.id'
  else if (form.id !== form.originalId && takenIds.includes(form.id))
    errors.id = 'settings.extensions.mcp.form.errors.idTaken'
  if (form.transport === 'stdio') {
    if (!form.command.trim()) errors.command = 'settings.extensions.mcp.form.errors.command'
    const cwd = form.cwd.trim()
    if (cwd && !(cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd)))
      errors.cwd = 'settings.extensions.mcp.form.errors.cwd'
  } else if (!isAllowedMcpUrl(form.url.trim())) errors.url = 'settings.extensions.mcp.form.errors.url'
  const names = form.secrets.map((s) => s.name.trim())
  if (names.some((n) => !MCP_SECRET_NAME_PATTERN.test(n)) || new Set(names).size !== names.length)
    errors.secrets = 'settings.extensions.mcp.form.errors.secrets'
  else if (form.transport === 'stdio' && names.some(isReservedMcpEnvName))
    errors.secrets = 'settings.extensions.mcp.form.errors.secretsReserved'
  const timeout = Number(form.timeoutSec)
  if (!Number.isInteger(timeout) || timeout < 5 || timeout > 600)
    errors.timeout = 'settings.extensions.mcp.form.errors.timeout'
  return errors
}

export function mcpDraftFromForm(form: McpForm): McpServerDraft {
  return {
    ...(form.originalId ? { originalId: form.originalId } : {}),
    id: form.id,
    label: form.label.trim(),
    enabled: form.enabled,
    transport: form.transport,
    command: form.transport === 'stdio' ? form.command.trim() : '',
    args:
      form.transport === 'stdio'
        ? form.args
            .split('\n')
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    ...(form.transport === 'stdio' && form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
    url: form.transport === 'stdio' ? '' : form.url.trim(),
    secrets: form.secrets.map((s) => ({ name: s.name.trim(), ...(s.value ? { value: s.value } : {}) })),
    defaultRisk: form.defaultRisk,
    toolRisk: form.toolRisk,
    disabledTools: form.disabledTools,
    timeoutMs: Number(form.timeoutSec) * 1000,
  }
}

// --------------------------------------------------------------------------------------------- hooks

export const HOOK_EVENT_LABEL: Record<UserHookEvent, MessageKey> = {
  SessionStart: 'settings.extensions.hooks.events.SessionStart',
  UserPromptSubmit: 'settings.extensions.hooks.events.UserPromptSubmit',
  PreToolUse: 'settings.extensions.hooks.events.PreToolUse',
  PostToolUse: 'settings.extensions.hooks.events.PostToolUse',
  Stop: 'settings.extensions.hooks.events.Stop',
}
export const HOOK_EVENT_DESCRIPTION: Record<UserHookEvent, MessageKey> = {
  SessionStart: 'settings.extensions.hooks.eventDesc.SessionStart',
  UserPromptSubmit: 'settings.extensions.hooks.eventDesc.UserPromptSubmit',
  PreToolUse: 'settings.extensions.hooks.eventDesc.PreToolUse',
  PostToolUse: 'settings.extensions.hooks.eventDesc.PostToolUse',
  Stop: 'settings.extensions.hooks.eventDesc.Stop',
}

export const OUTCOME_LABEL: Record<UserHookOutcome, MessageKey> = {
  allowed: 'settings.extensions.hooks.outcome.allowed',
  blocked: 'settings.extensions.hooks.outcome.blocked',
  context: 'settings.extensions.hooks.outcome.context',
  failed: 'settings.extensions.hooks.outcome.failed',
  timeout: 'settings.extensions.hooks.outcome.timeout',
}
export const OUTCOME_HINT: Record<UserHookOutcome, 'success' | 'info' | 'warning' | 'error'> = {
  allowed: 'success',
  blocked: 'warning',
  context: 'info',
  failed: 'error',
  timeout: 'error',
}

export const isToolEvent = (event: UserHookEvent): boolean => TOOL_HOOK_EVENTS.includes(event)

export interface HookForm {
  id?: string
  label: string
  enabled: boolean
  event: UserHookEvent
  matcher: string
  command: string
  timeoutSec: string
  sandbox: boolean
}

export function blankHookForm(): HookForm {
  return { label: '', enabled: true, event: 'PreToolUse', matcher: '', command: '', timeoutSec: '60', sandbox: true }
}

export function hookFormFromView(view: UserHookView): HookForm {
  return {
    id: view.id,
    label: view.label,
    enabled: view.enabled,
    event: view.event,
    matcher: view.matcher,
    command: view.command,
    timeoutSec: String(Math.round(view.timeoutMs / 1000)),
    sandbox: view.sandbox,
  }
}

export type HookFormField = 'command' | 'matcher' | 'timeout'

export function validateHookForm(form: HookForm): Partial<Record<HookFormField, MessageKey>> {
  const errors: Partial<Record<HookFormField, MessageKey>> = {}
  if (!form.command.trim()) errors.command = 'settings.extensions.hooks.form.errors.command'
  if (isToolEvent(form.event) && !compileHookMatcher(form.matcher))
    errors.matcher = 'settings.extensions.hooks.form.errors.matcher'
  const timeout = Number(form.timeoutSec)
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)
    errors.timeout = 'settings.extensions.hooks.form.errors.timeout'
  return errors
}

export function hookDraftFromForm(form: HookForm): UserHookDraft {
  return {
    ...(form.id ? { id: form.id } : {}),
    label: form.label.trim(),
    enabled: form.enabled,
    event: form.event,
    matcher: isToolEvent(form.event) ? form.matcher.trim() : '',
    command: form.command.trim(),
    timeoutMs: Number(form.timeoutSec) * 1000,
    sandbox: form.sandbox,
  }
}
