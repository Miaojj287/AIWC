/**
 * A tools-only MCP client over one transport: initialize handshake, paginated `tools/list`, `tools/call` with the
 * caller's AbortSignal, and the `list_changed` notification. Server output is validated before use.
 */
import { z } from 'zod'
import { createRpcSession, McpError, type McpTransport, type RpcSession } from './jsonRpc'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_CONNECT_TIMEOUT_MS = 30_000
export const MCP_LIST_TIMEOUT_MS = 30_000
const MAX_TOOL_PAGES = 20
const MAX_TOOLS = 500

const ToolSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(8000).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z
    .object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional() })
    .loose()
    .optional(),
})
export type McpRemoteTool = z.infer<typeof ToolSchema>

const InitializeSchema = z.object({
  protocolVersion: z.string().optional(),
  serverInfo: z.object({ name: z.string().optional(), version: z.string().optional() }).loose().optional(),
})
const ListSchema = z.object({ tools: z.array(z.unknown()), nextCursor: z.string().optional() })

const ContentSchema = z.array(
  z
    .object({
      type: z.string(),
      text: z.string().optional(),
      mimeType: z.string().optional(),
      resource: z.object({ uri: z.string().optional(), text: z.string().optional() }).loose().optional(),
    })
    .loose(),
)
const CallResultSchema = z.object({
  content: ContentSchema.optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
})

export interface McpCallResult {
  text: string
  isError: boolean
}

export interface McpClient {
  readonly serverName?: string
  readonly serverVersion?: string
  listTools(signal?: AbortSignal): Promise<McpRemoteTool[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { timeoutMs: number; signal: AbortSignal },
  ): Promise<McpCallResult>
  close(): Promise<void>
}

export interface ConnectOptions {
  transport: McpTransport & { setProtocolVersion?(version: string): void }
  clientVersion: string
  onClose(error?: McpError): void
  onToolsChanged(): void
}

/** The text the model reads for a call result: text parts as-is, other parts as short placeholders. */
export function renderCallResult(raw: unknown): McpCallResult {
  const parsed = CallResultSchema.safeParse(raw)
  if (!parsed.success) throw new McpError('protocol', 'invalid tools/call result')
  const parts: string[] = []
  for (const part of parsed.data.content ?? []) {
    if (part.type === 'text' && part.text !== undefined) parts.push(part.text)
    else if (part.type === 'resource' && part.resource?.text !== undefined) parts.push(part.resource.text)
    else if (part.type === 'resource_link' || part.type === 'resource')
      parts.push(`[resource ${part.resource?.uri ?? ''}]`)
    else parts.push(`[${part.type}${part.mimeType ? ` ${part.mimeType}` : ''} omitted]`)
  }
  if (parts.length === 0 && parsed.data.structuredContent !== undefined)
    parts.push(JSON.stringify(parsed.data.structuredContent))
  return { text: parts.join('\n\n'), isError: parsed.data.isError === true }
}

export async function connectMcp(opts: ConnectOptions): Promise<McpClient> {
  const session: RpcSession = createRpcSession(opts.transport, opts.onClose)
  session.onNotification = (method) => {
    if (method === 'notifications/tools/list_changed') opts.onToolsChanged()
  }
  try {
    await opts.transport.start()
    const init = InitializeSchema.safeParse(
      await session.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'AIWC', version: opts.clientVersion },
        },
        { timeoutMs: MCP_CONNECT_TIMEOUT_MS },
      ),
    )
    if (!init.success) throw new McpError('protocol', 'invalid initialize result')
    if (init.data.protocolVersion) opts.transport.setProtocolVersion?.(init.data.protocolVersion)
    await session.notify('notifications/initialized')
    const info = init.data.serverInfo
    return {
      serverName: info?.name,
      serverVersion: info?.version,
      async listTools(signal) {
        const tools: McpRemoteTool[] = []
        let cursor: string | undefined
        for (let page = 0; page < MAX_TOOL_PAGES; page++) {
          const res = ListSchema.safeParse(
            await session.request('tools/list', cursor ? { cursor } : {}, { timeoutMs: MCP_LIST_TIMEOUT_MS, signal }),
          )
          if (!res.success) throw new McpError('protocol', 'invalid tools/list result')
          for (const raw of res.data.tools) {
            const tool = ToolSchema.safeParse(raw)
            if (tool.success && tools.length < MAX_TOOLS) tools.push(tool.data)
          }
          cursor = res.data.nextCursor
          if (!cursor) break
        }
        return tools
      },
      async callTool(name, args, callOpts) {
        const raw = await session.request('tools/call', { name, arguments: args }, callOpts)
        return renderCallResult(raw)
      },
      close: () => session.close(),
    }
  } catch (err) {
    await session.close().catch(() => undefined) // already failing; the original error is what matters
    throw err instanceof McpError ? err : new McpError('protocol', err instanceof Error ? err.message : String(err))
  }
}
