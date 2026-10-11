/**
 * `<dataRoot>/extensions.json`: the MCP servers and user hooks. Kept out of config.json because it names commands
 * the app runs: only the `mcp:*` / `hooks:*` handlers write it, after validation (and a native confirmation for a new
 * command). Secret values (env vars, HTTP headers) live in the secret store; the file holds their refs. A broken
 * entry is dropped and logged on its own, never the whole file. Writes are atomic (tmp + rename, mode 0600).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ExtensionsFileSchema,
  McpServerConfigSchema,
  UserHookConfigSchema,
  type McpServerConfig,
  type UserHookConfig,
} from '@aiwc/protocol'
import type { Logger } from '../log'

export interface ExtensionsStore {
  listMcp(): McpServerConfig[]
  getMcp(id: string): McpServerConfig | undefined
  /** Insert or replace by id; `replacing` = the id being renamed away from. */
  saveMcp(server: McpServerConfig, replacing?: string): void
  removeMcp(id: string): void
  listHooks(): UserHookConfig[]
  getHook(id: string): UserHookConfig | undefined
  saveHook(hook: UserHookConfig): void
  removeHook(id: string): void
  /** Listeners run after every successful write. */
  subscribe(listener: () => void): () => void
}

/** Secret-store ref of one env var / header value of a server. */
export const mcpSecretRef = (serverId: string, name: string): string => `mcp.${serverId}.${name}`

export function createExtensionsStore(opts: { file: string; logger: Logger }): ExtensionsStore {
  const log = opts.logger.child('extensions')
  let servers: McpServerConfig[] = []
  let hooks: UserHookConfig[] = []
  const listeners = new Set<() => void>()

  load()

  function load(): void {
    if (!existsSync(opts.file)) return
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(opts.file, 'utf8'))
    } catch (err) {
      log.error('extensions.json could not be parsed; backed up and starting empty', err)
      try {
        renameSync(opts.file, `${opts.file}.bak-${Date.now()}`)
      } catch (renameErr) {
        log.warn('extensions.json backup failed', renameErr)
      }
      return
    }
    const file = ExtensionsFileSchema.safeParse(raw)
    if (!file.success) {
      log.warn('extensions.json has an unexpected shape; ignored')
      return
    }
    for (const entry of file.data.mcpServers) {
      const parsed = McpServerConfigSchema.safeParse(entry)
      if (parsed.success && !servers.some((s) => s.id === parsed.data.id)) servers.push(parsed.data)
      else log.warn('dropped an invalid MCP server entry')
    }
    for (const entry of file.data.hooks) {
      const parsed = UserHookConfigSchema.safeParse(entry)
      if (parsed.success && !hooks.some((h) => h.id === parsed.data.id)) hooks.push(parsed.data)
      else log.warn('dropped an invalid hook entry')
    }
  }

  function persist(): void {
    mkdirSync(dirname(opts.file), { recursive: true })
    const tmp = `${opts.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, mcpServers: servers, hooks }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    try {
      chmodSync(tmp, 0o600)
    } catch {
      // Windows: no mode bits; the userData ACL protects the file.
    }
    renameSync(tmp, opts.file)
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (err) {
        log.warn('extensions listener failed', err)
      }
    }
  }

  return {
    listMcp: () => servers.map((s) => ({ ...s })),
    getMcp: (id) => servers.find((s) => s.id === id),
    saveMcp(server, replacing) {
      const drop = new Set([server.id, ...(replacing ? [replacing] : [])])
      const index = servers.findIndex((s) => drop.has(s.id))
      const rest = servers.filter((s) => !drop.has(s.id))
      rest.splice(index >= 0 ? Math.min(index, rest.length) : rest.length, 0, server)
      servers = rest
      persist()
    },
    removeMcp(id) {
      servers = servers.filter((s) => s.id !== id)
      persist()
    },
    listHooks: () => hooks.map((h) => ({ ...h })),
    getHook: (id) => hooks.find((h) => h.id === id),
    saveHook(hook) {
      const index = hooks.findIndex((h) => h.id === hook.id)
      if (index >= 0) hooks = hooks.map((h, i) => (i === index ? hook : h))
      else hooks = [...hooks, hook]
      persist()
    },
    removeHook(id) {
      hooks = hooks.filter((h) => h.id !== id)
      persist()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
