/**
 * MCP tools as kernel tools: one `defineTool` per server tool, namespaced `mcp__<server>__<tool>`. The risk comes from
 * the user (server default or per-tool override); a server's own `destructiveHint` makes it destructive whatever the
 * user chose (no override can lower it), and a `readOnlyHint` never lowers it. Tools of a remote server are `offDevice`, so a local-model thread never mounts them.
 * Output is plain text and truncated at record time like every tool's (kernel router).
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  defineTool,
  MCP_TOOL_PREFIX,
  type AnyToolDefinition,
  type McpServerConfig,
  type McpToolRisk,
  type McpToolView,
  type ToolProfile,
  type ToolRisk,
} from '@aiwc/protocol'
import type { McpCallResult, McpRemoteTool } from './client'

const TOOL_NAME_MAX = 64
const DESCRIPTION_MAX = 1_000
const SCHEMA_MAX_CHARS = 20_000
/** Extra time over the server's call timeout before the kernel's own timeout fires. */
const ROUTER_GRACE_MS = 5_000
const SUMMARY_ARGS_CHARS = 80

const short = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 4)

/** A tool-name-safe, unique name for `tool` of `serverId`; `taken` holds names already handed out. */
export function mcpToolName(serverId: string, tool: string, taken: ReadonlySet<string>): string {
  const prefix = `${MCP_TOOL_PREFIX}${serverId}__`
  const room = TOOL_NAME_MAX - prefix.length
  const base =
    tool
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tool'
  const plain = prefix + base
  if (base.length <= room && !taken.has(plain) && base === tool) return plain
  // Changed, too long or colliding: keep it recognisable and make it unique with a hash of the original name.
  for (let attempt = 0; ; attempt++) {
    const suffix = `_${short(attempt ? `${tool}#${attempt}` : tool)}`
    const candidate = `${prefix}${base.slice(0, room - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The server declares the tool destructive (and not also read-only, which would contradict it). */
export const declaredDestructive = (
  hints: { destructiveHint?: boolean; readOnlyHint?: boolean } | undefined,
): boolean => hints?.destructiveHint === true && hints.readOnlyHint !== true

export function effectiveRisk(server: McpServerConfig, tool: McpRemoteTool): McpToolRisk | 'destructive' {
  // checked before the override: a user override can only ever pick read / write / send, i.e. lower it
  if (declaredDestructive(tool.annotations)) return 'destructive'
  return server.toolRisk[tool.name] ?? server.defaultRisk
}

/** The model-facing schema: the server's own, when it is a sane object schema. */
export function sanitizeInputSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const fallback = { type: 'object', properties: {}, additionalProperties: true }
  if (!schema) return fallback
  let size = 0
  try {
    size = JSON.stringify(schema).length
  } catch {
    return fallback
  }
  if (size > SCHEMA_MAX_CHARS) return fallback
  const { $schema: _ignored, ...rest } = schema
  if (rest.type !== undefined && rest.type !== 'object') return fallback
  return { ...rest, type: 'object', properties: rest.properties ?? {} }
}

export function toolViews(
  server: McpServerConfig,
  tools: readonly McpRemoteTool[],
  names: ReadonlyMap<string, string>,
): McpToolView[] {
  return tools.map((tool) => ({
    name: tool.name,
    toolName: names.get(tool.name) ?? '',
    description: (tool.description ?? '').slice(0, DESCRIPTION_MAX),
    risk: effectiveRisk(server, tool),
    ...(server.toolRisk[tool.name] ? { override: server.toolRisk[tool.name] } : {}),
    ...(tool.annotations?.readOnlyHint !== undefined ? { declaredReadOnly: tool.annotations.readOnlyHint } : {}),
    ...(tool.annotations?.destructiveHint !== undefined
      ? { declaredDestructive: tool.annotations.destructiveHint }
      : {}),
    disabled: server.disabledTools.includes(tool.name),
  }))
}

const compactArgs = (input: unknown): string => {
  let text = ''
  try {
    text = JSON.stringify(input) ?? ''
  } catch {
    return ''
  }
  text = text.replace(/\s+/g, ' ')
  if (text === '{}') return ''
  return text.length > SUMMARY_ARGS_CHARS ? `${text.slice(0, SUMMARY_ARGS_CHARS - 1)}…` : text
}

export interface McpToolDeps {
  server: McpServerConfig
  tool: McpRemoteTool
  toolName: string
  call(args: Record<string, unknown>, opts: { timeoutMs: number; signal: AbortSignal }): Promise<McpCallResult>
}

export function createMcpToolDefinition(deps: McpToolDeps): AnyToolDefinition {
  const { server, tool } = deps
  const risk: ToolRisk = effectiveRisk(server, tool)
  // Read-only tools may also serve read-only sub-agents; nothing from MCP is mounted on WeChat bot threads.
  const profiles: ToolProfile[] = risk === 'read' ? ['desktop-chat', 'cron', 'subagent'] : ['desktop-chat', 'cron']
  const description = `[MCP · ${server.label}] ${(tool.description ?? tool.name).slice(0, DESCRIPTION_MAX)}`
  return defineTool<Record<string, unknown>>({
    name: deps.toolName,
    description,
    // The server validates its own arguments; the kernel only insists on an object.
    inputSchema: z.record(z.string(), z.unknown()),
    inputJsonSchema: sanitizeInputSchema(tool.inputSchema),
    offDevice: server.transport !== 'stdio',
    profiles,
    risk,
    parallelSafe: false,
    timeoutMs: server.timeoutMs + ROUTER_GRACE_MS,
    summarize: (input) => [`${server.label} · ${tool.name}`, compactArgs(input)].filter(Boolean).join(' '),
    // the server's label is only known here; the panel words the row as 「label · tool args」 in either language
    describe: (input) => ({ code: 'mcp', params: { server: server.label, tool: tool.name, args: compactArgs(input) } }),
    async execute(input, ctx) {
      const result = await deps.call(input, { timeoutMs: server.timeoutMs, signal: ctx.signal })
      return { content: result.text, isError: result.isError }
    },
  })
}
