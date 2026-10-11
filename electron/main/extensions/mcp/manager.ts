/**
 * MCP server lifecycle: connect enabled servers in the background at start-up, register their tools in the kernel
 * registry, reconnect on demand (restart / save), drop the tools the moment a server goes away, and close every
 * connection (killing stdio process groups) on quit. A stale connection attempt never wins over a newer one: each
 * server carries a generation number and late results of an older generation are discarded.
 */
import { isAbsolute } from 'node:path'
import type { CliEnv } from '@aiwc/shell'
import { isReservedMcpEnvName, type McpServerConfig, type McpServerStatus } from '@aiwc/protocol'
import type { ToolRegistry } from '@aiwc/kernel'
import type { Logger } from '../../log'
import type { SecretStore } from '../../config/secretStore'
import { mcpSecretRef, type ExtensionsStore } from '../store'
import { connectMcp, type McpClient, type McpRemoteTool } from './client'
import { McpError, type McpTransport } from './jsonRpc'
import { createHttpTransport, createSseTransport, createStdioTransport, type StdioTransport } from './transports'
import { createMcpToolDefinition, mcpToolName, toolViews } from './tools'

const TOOLS_CHANGED_DEBOUNCE_MS = 500

export interface McpManagerDeps {
  store: Pick<ExtensionsStore, 'listMcp' | 'getMcp'>
  secrets: Pick<SecretStore, 'reveal'>
  registry: Pick<ToolRegistry, 'register' | 'unregister'>
  /** Login-shell PATH etc. for stdio servers (npx, uvx…). */
  cliEnv: () => Promise<Pick<CliEnv, 'env' | 'which'>>
  /** How to start a resolved command (npm shims on Windows); identity by default. */
  resolveCommand?: (binPath: string) => Promise<{ command: string; prefixArgs: string[]; env?: NodeJS.ProcessEnv }>
  clientVersion: string
  onStatus: (status: McpServerStatus) => void
  logger: Logger
  now?: () => number
  /** Tests: replace the transport. */
  createTransport?: (server: McpServerConfig, secrets: Record<string, string>) => Promise<McpTransport>
}

export interface McpManager {
  /** Connect every enabled server (not awaited by the caller: start-up must not wait on a slow server). */
  start(): Promise<void>
  status(id: string): McpServerStatus
  /** Reconnect a server from its stored config (or stop it when disabled / removed). Resolves once settled. */
  reload(id: string): Promise<McpServerStatus>
  /** Forget a removed server (closes it, drops its tools). */
  drop(id: string): Promise<void>
  /** Re-register the tools of a ready server after a tool policy change, without reconnecting. */
  reapplyTools(id: string): McpServerStatus
  shutdown(): Promise<void>
}

interface Entry {
  generation: number
  client?: McpClient
  transport?: McpTransport
  remoteTools: McpRemoteTool[]
  /** server tool name → registered kernel tool name */
  names: Map<string, string>
  status: McpServerStatus
  toolsTimer?: ReturnType<typeof setTimeout>
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const log = deps.logger.child('mcp')
  const now = deps.now ?? Date.now
  const entries = new Map<string, Entry>()

  const entry = (id: string): Entry => {
    let e = entries.get(id)
    if (!e) {
      e = {
        generation: 0,
        remoteTools: [],
        names: new Map(),
        status: { id, state: 'disabled', tools: [], updatedAt: now() },
      }
      entries.set(id, e)
    }
    return e
  }

  const publish = (
    e: Entry,
    patch: Omit<McpServerStatus, 'id' | 'updatedAt' | 'tools'> & { tools?: McpServerStatus['tools'] },
  ): McpServerStatus => {
    e.status = { id: e.status.id, tools: [], ...patch, updatedAt: now() }
    try {
      deps.onStatus(e.status)
    } catch (err) {
      log.warn('mcp status listener failed', err)
    }
    return e.status
  }

  const unregisterTools = (e: Entry): void => {
    for (const name of e.names.values()) deps.registry.unregister(name)
    e.names.clear()
  }

  const takenNames = (except: Entry): Set<string> => {
    const taken = new Set<string>()
    for (const other of entries.values()) if (other !== except) for (const n of other.names.values()) taken.add(n)
    return taken
  }

  const registerTools = (server: McpServerConfig, e: Entry): void => {
    unregisterTools(e)
    const taken = takenNames(e)
    for (const tool of e.remoteTools) {
      const name = mcpToolName(server.id, tool.name, taken)
      taken.add(name)
      e.names.set(tool.name, name)
      if (server.disabledTools.includes(tool.name)) continue
      const client = e.client
      try {
        deps.registry.register(
          createMcpToolDefinition({
            server,
            tool,
            toolName: name,
            call: (args, opts) => {
              if (!client || e.client !== client) throw new McpError('exited', 'server is not connected')
              return client.callTool(tool.name, args, opts)
            },
          }),
        )
      } catch (err) {
        log.warn('mcp tool not registered', { server: server.id, tool: tool.name, err })
      }
    }
  }

  const readySnapshot = (server: McpServerConfig, e: Entry): McpServerStatus =>
    publish(e, {
      state: 'ready',
      serverName: e.client?.serverName,
      serverVersion: e.client?.serverVersion,
      tools: toolViews(server, e.remoteTools, e.names),
    })

  const closeEntry = async (e: Entry): Promise<void> => {
    if (e.toolsTimer) clearTimeout(e.toolsTimer)
    e.toolsTimer = undefined
    unregisterTools(e)
    const client = e.client
    const transport = e.transport
    e.client = undefined
    e.transport = undefined
    e.remoteTools = []
    try {
      if (client) await client.close()
      else await transport?.close()
    } catch (err) {
      log.debug('mcp close failed', err)
    }
  }

  const secretValues = (server: McpServerConfig): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const s of server.secrets) {
      const value = deps.secrets.reveal(s.ref || mcpSecretRef(server.id, s.name))
      if (value === null) throw new McpError('missing_secret', s.name)
      out[s.name] = value
    }
    return out
  }

  const withoutReserved = (secrets: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(secrets).filter(([name]) => !isReservedMcpEnvName(name)))

  const defaultTransport = async (server: McpServerConfig, secrets: Record<string, string>): Promise<McpTransport> => {
    const debug = (message: string, meta?: unknown) => log.debug(message, { server: server.id, meta })
    if (server.transport === 'stdio') {
      const cli = await deps.cliEnv()
      const looksLikePath = isAbsolute(server.command) || /[\\/]/.test(server.command)
      const bin = looksLikePath ? server.command : ((await cli.which(server.command)) ?? server.command)
      const resolved = deps.resolveCommand ? await deps.resolveCommand(bin) : { command: bin, prefixArgs: [] }
      return createStdioTransport({
        command: resolved.command,
        args: [...resolved.prefixArgs, ...server.args],
        // The schema refuses reserved names already; never let a secret redirect what runs (PATH, NODE_OPTIONS…).
        env: { ...cli.env, ...resolved.env, ...withoutReserved(secrets) },
        cwd: server.cwd || undefined,
        onDebug: debug,
      })
    }
    const make = server.transport === 'http' ? createHttpTransport : createSseTransport
    return make({ url: server.url, headers: secrets, onDebug: debug })
  }

  const connect = async (server: McpServerConfig): Promise<McpServerStatus> => {
    const e = entry(server.id)
    const generation = ++e.generation
    await closeEntry(e)
    if (generation !== e.generation) return e.status
    if (!server.enabled) return publish(e, { state: 'disabled' })
    publish(e, { state: 'connecting' })
    let transport: McpTransport | undefined
    try {
      const secrets = secretValues(server)
      transport = await (deps.createTransport ?? defaultTransport)(server, secrets)
      e.transport = transport
      const client = await connectMcp({
        transport,
        clientVersion: deps.clientVersion,
        onClose: (error) => {
          if (generation !== e.generation) return
          log.warn('mcp server disconnected', { server: server.id, error: error?.message })
          unregisterTools(e)
          e.client = undefined
          e.transport = undefined
          publish(e, { state: 'error', errorCode: error?.code ?? 'exited', error: error?.message })
        },
        onToolsChanged: () => {
          if (generation !== e.generation) return
          if (e.toolsTimer) clearTimeout(e.toolsTimer)
          e.toolsTimer = setTimeout(() => void refreshTools(server.id, generation), TOOLS_CHANGED_DEBOUNCE_MS)
        },
      })
      if (generation !== e.generation) {
        await client.close().catch(() => undefined) // superseded by a newer attempt
        return e.status
      }
      e.client = client
      e.remoteTools = await client.listTools()
      if (generation !== e.generation) return e.status
      registerTools(server, e)
      log.info('mcp server ready', { server: server.id, tools: e.remoteTools.length })
      return readySnapshot(server, e)
    } catch (err) {
      if (generation !== e.generation) return e.status
      const error =
        err instanceof McpError ? err : new McpError('protocol', err instanceof Error ? err.message : String(err))
      const tail = (transport as StdioTransport | undefined)?.stderrTail?.()
      log.warn('mcp server failed to connect', { server: server.id, code: error.code })
      await closeEntry(e)
      return publish(e, { state: 'error', errorCode: error.code, error: tail || error.message })
    }
  }

  const refreshTools = async (id: string, generation: number): Promise<void> => {
    const e = entries.get(id)
    const server = deps.store.getMcp(id)
    if (!e || !server || generation !== e.generation || !e.client) return
    try {
      e.remoteTools = await e.client.listTools()
      if (generation !== e.generation) return
      registerTools(server, e)
      readySnapshot(server, e)
    } catch (err) {
      log.warn('mcp tools refresh failed', { server: id, err })
    }
  }

  const status = (id: string): McpServerStatus =>
    entries.get(id)?.status ?? { id, state: 'disabled', tools: [], updatedAt: now() }
  const drop = async (id: string): Promise<void> => {
    const e = entries.get(id)
    if (!e) return
    e.generation++
    await closeEntry(e)
    entries.delete(id)
  }

  return {
    async start() {
      await Promise.all(deps.store.listMcp().map((server) => connect(server)))
    },
    status,
    async reload(id) {
      const server = deps.store.getMcp(id)
      if (server) return connect(server)
      await drop(id)
      return status(id)
    },
    drop,
    reapplyTools(id) {
      const e = entries.get(id)
      const server = deps.store.getMcp(id)
      if (!e || !server || e.status.state !== 'ready') return status(id)
      registerTools(server, e)
      return readySnapshot(server, e)
    },
    async shutdown() {
      await Promise.all(
        [...entries.values()].map(async (e) => {
          e.generation++
          await closeEntry(e)
        }),
      )
      entries.clear()
    },
  }
}
