/**
 * 设置 › 扩展 behind the `mcp:*` / `hooks:*` channels: validates every request again (the renderer is not trusted
 * with commands), asks the user natively before a new or changed command / endpoint is saved, keeps secret values in
 * the secret store, and tells the MCP manager what changed. Connecting never blocks a save: the status follows on
 * `mcp:status`.
 */
import { nanoid } from 'nanoid'
import {
  MCP_MAX_SERVERS,
  McpServerConfigSchema,
  McpServerDraftSchema,
  USER_HOOK_MAX,
  UserHookConfigSchema,
  UserHookDraftSchema,
  type ExtensionSaveResult,
  type McpServerConfig,
  type McpServerView,
  type McpToolRisk,
  type UserHookConfig,
  type UserHookTestResult,
  type UserHookView,
} from '@aiwc/protocol'
import type { z } from 'zod'
import type { SecretStore } from '../config/secretStore'
import type { Logger } from '../log'
import { t } from '../i18n'
import { confirmationDetail, fitsConfirmation, MAX_CONFIRM_DETAIL_CHARS, MAX_CONFIRM_DETAIL_LINES } from './confirmText'
import type { McpManager } from './mcp/manager'
import { declaredDestructive } from './mcp/tools'
import { mcpSecretRef, type ExtensionsStore } from './store'
import type { UserHooks } from './userHooks'

/** What the native confirmation shows: which thing, and the exact command / URL it will run or reach. */
export interface CommandConfirmation {
  kind: 'mcp' | 'hook'
  label: string
  detail: string
}
export type ConfirmCommand = (request: CommandConfirmation) => Promise<boolean>

export interface ExtensionsServiceDeps {
  store: ExtensionsStore
  secrets: Pick<SecretStore, 'has' | 'set' | 'delete' | 'reveal'>
  mcp: McpManager
  hooks: UserHooks
  logger: Logger
}

export interface ExtensionsService {
  listMcp(): McpServerView[]
  saveMcp(draft: unknown, confirm: ConfirmCommand): Promise<ExtensionSaveResult<McpServerView>>
  removeMcp(id: unknown): Promise<void>
  setMcpEnabled(id: unknown, enabled: unknown): McpServerView
  restartMcp(id: unknown): Promise<McpServerView>
  setToolPolicy(req: { id: unknown; tool: unknown; risk?: unknown; disabled?: unknown }): McpServerView
  listHooks(): { hooks: UserHookView[]; sandbox: boolean }
  saveHook(draft: unknown, confirm: ConfirmCommand): Promise<ExtensionSaveResult<UserHookView>>
  removeHook(id: unknown): void
  setHookEnabled(id: unknown, enabled: unknown): UserHookView
  testHook(id: unknown): Promise<UserHookTestResult>
}

const RISKS: readonly McpToolRisk[] = ['read', 'write', 'send']

function invalid(error: z.ZodError): Error {
  const field = error.issues[0]?.path.map(String).join('.') || '-'
  return new Error(t('main.extensions.invalid', { field }), { cause: error })
}

const asString = (v: unknown): string => {
  if (typeof v !== 'string' || !v) throw new Error(t('main.extensions.invalid', { field: 'id' }))
  return v
}
const asBool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new Error(t('main.extensions.invalid', { field: 'enabled' }))
  return v
}

type RunnableFields = Pick<McpServerConfig, 'transport' | 'command' | 'args' | 'cwd' | 'url'> & {
  secrets: ReadonlyArray<{ name: string }>
}

/** stdio: the env names its secrets set (sorted). Their values stay secret; the names shape what runs. */
const envNames = (s: RunnableFields): string[] =>
  s.transport === 'stdio' ? [...new Set(s.secrets.map((x) => x.name))].sort() : []

/**
 * What a server runs or reaches; a change here needs the user's confirmation again. For stdio that
 * includes the names of the env vars its secrets set: adding or renaming one changes the process.
 */
const runnableIdentity = (s: RunnableFields): string =>
  JSON.stringify([s.transport, s.command, s.args, s.cwd ?? '', s.url, envNames(s)])

const describeServer = (s: RunnableFields): string => {
  if (s.transport !== 'stdio') return s.url
  const names = envNames(s)
  return (
    [s.command, ...s.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ') +
    (s.cwd ? `\n(${s.cwd})` : '') +
    (names.length ? `\n${names.map((n) => `${n}=…`).join(' ')}` : '')
  )
}

/** The confirmation text, or a refusal when the dialog could not show all of it (no hidden tail, ever). */
function shownDetail(raw: string): string {
  const detail = confirmationDetail(raw)
  if (!fitsConfirmation(detail))
    throw new Error(
      t('main.extensions.commandTooLong', { max: MAX_CONFIRM_DETAIL_CHARS, lines: MAX_CONFIRM_DETAIL_LINES }),
    )
  return detail
}

export function createExtensionsService(deps: ExtensionsServiceDeps): ExtensionsService {
  const log = deps.logger.child('extensions')
  const { store, secrets, mcp } = deps

  const requireServer = (id: string): McpServerConfig => {
    const server = store.getMcp(id)
    if (!server) throw new Error(t('main.extensions.serverNotFound'))
    return server
  }
  const requireHook = (id: string): UserHookConfig => {
    const hook = store.getHook(id)
    if (!hook) throw new Error(t('main.extensions.hookNotFound'))
    return hook
  }

  const view = (server: McpServerConfig): McpServerView => {
    const { secrets: refs, ...rest } = server
    return {
      ...rest,
      secrets: refs.map((s) => ({ name: s.name, hasValue: secrets.has(s.ref) })),
      status: mcp.status(server.id),
    }
  }
  /** Right after a save the manager is still closing the old connection: show where it is heading. */
  const pendingView = (server: McpServerConfig): McpServerView => {
    const v = view(server)
    return { ...v, status: { ...v.status, state: server.enabled ? 'connecting' : 'disabled', tools: [] } }
  }
  const reload = (id: string): void => {
    void mcp.reload(id).catch((err: unknown) => log.warn('mcp reload failed', { id, err }))
  }
  const hookView = (hook: UserHookConfig): UserHookView => {
    const lastRun = deps.hooks.lastRun(hook.id)
    return lastRun ? { ...hook, lastRun } : { ...hook }
  }

  return {
    listMcp: () => store.listMcp().map(view),

    async saveMcp(rawDraft, confirm) {
      const parsed = McpServerDraftSchema.safeParse(rawDraft)
      if (!parsed.success) throw invalid(parsed.error)
      const draft = parsed.data
      const previousId = draft.originalId ?? draft.id
      const previous = store.getMcp(previousId)
      if (draft.originalId && !previous) throw new Error(t('main.extensions.serverNotFound'))
      if (draft.id !== previousId && store.getMcp(draft.id)) throw new Error(t('main.extensions.duplicateId'))
      if (!previous && store.listMcp().length >= MCP_MAX_SERVERS) throw new Error(t('main.extensions.tooMany'))
      const names = draft.secrets.map((s) => s.name)
      if (new Set(names).size !== names.length) throw new Error(t('main.extensions.invalid', { field: 'secrets' }))

      if (!previous || runnableIdentity(previous) !== runnableIdentity(draft)) {
        const ok = await confirm({ kind: 'mcp', label: draft.label, detail: shownDetail(describeServer(draft)) })
        if (!ok) return { ok: false, reason: 'not_confirmed' }
      }

      // Secret values: a typed value replaces; an untouched one is carried over (also across an id rename).
      const refs = draft.secrets.map((s) => {
        const ref = mcpSecretRef(draft.id, s.name)
        if (s.value !== undefined && s.value !== '') secrets.set(ref, s.value)
        else if (previous && previousId !== draft.id) {
          const old = previous.secrets.find((p) => p.name === s.name)
          const value = old ? secrets.reveal(old.ref) : null
          if (value !== null) secrets.set(ref, value)
        }
        return { name: s.name, ref }
      })
      const kept = new Set(refs.map((r) => r.ref))
      for (const old of previous?.secrets ?? []) if (!kept.has(old.ref)) secrets.delete(old.ref)

      const { originalId: _originalId, secrets: _drafted, ...config } = draft
      const server = McpServerConfigSchema.parse({ ...config, secrets: refs })
      store.saveMcp(server, previousId !== server.id ? previousId : undefined)
      if (previousId !== server.id) void mcp.drop(previousId).catch((err: unknown) => log.warn('mcp drop failed', err))
      reload(server.id)
      return { ok: true, value: pendingView(server) }
    },

    async removeMcp(rawId) {
      const server = requireServer(asString(rawId))
      store.removeMcp(server.id)
      for (const s of server.secrets) secrets.delete(s.ref)
      await mcp.drop(server.id)
    },

    setMcpEnabled(rawId, rawEnabled) {
      const server = { ...requireServer(asString(rawId)), enabled: asBool(rawEnabled) }
      store.saveMcp(server)
      reload(server.id)
      return pendingView(server)
    },

    async restartMcp(rawId) {
      const server = requireServer(asString(rawId))
      await mcp.reload(server.id)
      return view(server)
    },

    setToolPolicy(req) {
      const server = requireServer(asString(req.id))
      const tool = asString(req.tool)
      if (tool.length > 128) throw new Error(t('main.extensions.invalid', { field: 'tool' }))
      const toolRisk = { ...server.toolRisk }
      if (req.risk === null) delete toolRisk[tool]
      else if (req.risk !== undefined) {
        if (!RISKS.includes(req.risk as McpToolRisk)) throw new Error(t('main.extensions.invalid', { field: 'risk' }))
        // a destructive tool always asks (tools.ts effectiveRisk); an override would only pretend to lower it
        const seen = mcp.status(server.id).tools.find((v) => v.name === tool)
        if (
          seen &&
          declaredDestructive({ destructiveHint: seen.declaredDestructive, readOnlyHint: seen.declaredReadOnly })
        )
          throw new Error(t('main.extensions.destructiveOverride', { tool }))
        toolRisk[tool] = req.risk as McpToolRisk
      }
      let disabledTools = server.disabledTools
      if (req.disabled !== undefined) {
        const off = asBool(req.disabled)
        disabledTools = off ? [...new Set([...disabledTools, tool])] : disabledTools.filter((n) => n !== tool)
      }
      const next = McpServerConfigSchema.parse({ ...server, toolRisk, disabledTools })
      store.saveMcp(next)
      mcp.reapplyTools(next.id)
      return view(next)
    },

    listHooks: () => ({ hooks: store.listHooks().map(hookView), sandbox: deps.hooks.sandboxAvailable() }),

    async saveHook(rawDraft, confirm) {
      const parsed = UserHookDraftSchema.safeParse(rawDraft)
      if (!parsed.success) throw invalid(parsed.error)
      const draft = parsed.data
      const previous = draft.id ? store.getHook(draft.id) : undefined
      if (draft.id && !previous) throw new Error(t('main.extensions.hookNotFound'))
      if (!previous && store.listHooks().length >= USER_HOOK_MAX) throw new Error(t('main.extensions.tooMany'))
      // A new command, or one that leaves the sandbox, is run only after the user has seen it.
      const widened = !draft.sandbox && (previous?.sandbox ?? true)
      if (!previous || previous.command !== draft.command || widened) {
        const ok = await confirm({
          kind: 'hook',
          label: draft.label || draft.event,
          detail: shownDetail(draft.command),
        })
        if (!ok) return { ok: false, reason: 'not_confirmed' }
      }
      const hook = UserHookConfigSchema.parse({ ...draft, id: previous?.id ?? `hk_${nanoid(10)}` })
      store.saveHook(hook)
      return { ok: true, value: hookView(hook) }
    },

    removeHook(rawId) {
      store.removeHook(requireHook(asString(rawId)).id)
    },

    setHookEnabled(rawId, rawEnabled) {
      const hook = { ...requireHook(asString(rawId)), enabled: asBool(rawEnabled) }
      store.saveHook(hook)
      return hookView(hook)
    },

    testHook: (rawId) => deps.hooks.test(requireHook(asString(rawId))),
  }
}
