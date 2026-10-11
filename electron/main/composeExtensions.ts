/**
 * 扩展 wiring for the composition root: MCP servers (tools registered into the kernel registry as they connect),
 * user command hooks (on the kernel's HookRunner, next to the host hooks), the `workflow_run` tool, and the service
 * behind 设置 › 扩展. Connecting servers never delays start-up; quitting closes every connection and kills stdio
 * server process groups.
 */
import { createWorkflowTool, type createKernel, type HookRunner, type ToolRegistry } from '@aiwc/kernel'
import { createCliEnv, createSandbox, resolveCommand, type CliEnv, type NodeRuntime } from '@aiwc/shell'
import type { Broadcast } from './contracts'
import type { SecretStore } from './config/secretStore'
import type { Logger } from './log'
import { extensionsFile, type AppPaths } from './paths'
import { createMcpManager } from './extensions/mcp/manager'
import { createExtensionsService, type ExtensionsService } from './extensions/service'
import { createExtensionsStore } from './extensions/store'
import { createUserHooks } from './extensions/userHooks'

/** Sent as clientInfo.version in the MCP handshake. */
const MCP_CLIENT_VERSION = '1.0.0'

export interface ComposeExtensionsDeps {
  paths: Pick<AppPaths, 'dataRoot' | 'workspaceDir'>
  /** Read per hook run: a custom cache dir set after startup is protected too. */
  protectedPaths: () => readonly string[]
  sandboxMode: () => 'auto' | 'off'
  secrets: SecretStore
  registry: ToolRegistry
  hooks: HookRunner
  kernel: ReturnType<typeof createKernel>
  broadcast: Broadcast
  logger: Logger
  env?: NodeJS.ProcessEnv
  /** Runs npm JS shims when there is no node on PATH (Electron as node). */
  fallbackNode?: NodeRuntime
}

export interface ComposedExtensions {
  service: ExtensionsService
  /** Connect the enabled MCP servers in the background. */
  start(): void
  shutdown(): Promise<void>
}

export function composeExtensions(deps: ComposeExtensionsDeps): ComposedExtensions {
  const log = deps.logger.child('extensions')
  const store = createExtensionsStore({ file: extensionsFile(deps.paths), logger: deps.logger })
  let cliEnvPromise: Promise<CliEnv> | undefined
  const cliEnv = (): Promise<CliEnv> => (cliEnvPromise ??= createCliEnv({ env: deps.env }))

  const mcp = createMcpManager({
    store,
    secrets: deps.secrets,
    registry: deps.registry,
    cliEnv,
    resolveCommand: async (bin) => resolveCommand(bin, await cliEnv(), deps.fallbackNode),
    clientVersion: MCP_CLIENT_VERSION,
    onStatus: (status) => deps.broadcast('mcp:status', status),
    logger: deps.logger,
  })

  const userHooks = createUserHooks({
    hooks: () => store.listHooks(),
    workspaceDir: deps.paths.workspaceDir,
    protectedPaths: deps.protectedPaths,
    sandboxMode: deps.sandboxMode,
    sandbox: createSandbox(),
    cliEnv,
    logger: deps.logger,
  })
  const removeHook = deps.hooks.add(userHooks.hook)
  const unsubscribe = deps.kernel.events.on((e) => {
    if (e.type === 'thread.created') userHooks.markNewThread(e.threadId)
  })

  // Spawns sub-agents, so it needs the kernel; the registry is read per step, so registering late is fine.
  deps.registry.register(createWorkflowTool(() => deps.kernel))

  const service = createExtensionsService({ store, secrets: deps.secrets, mcp, hooks: userHooks, logger: deps.logger })

  return {
    service,
    start() {
      // The login-shell PATH probe takes a few seconds once; do it now rather than inside the first hooked tool call.
      if (store.listHooks().some((h) => h.enabled))
        void cliEnv().catch((err: unknown) => log.warn('hook environment probe failed', err))
      void mcp.start().catch((err: unknown) => log.warn('mcp start failed', err))
    },
    async shutdown() {
      unsubscribe()
      removeHook()
      await mcp.shutdown()
    },
  }
}
