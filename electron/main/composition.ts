/**
 * Composition root: the ONLY place that knows about every package. createApp() wires config,
 * secrets, substrate (utility process), memory, gateway, kernel, auto-reply, diary and clone
 * builder together and bridges their event streams to the renderer (docs/ARCHITECTURE.md §3).
 *
 * Adding a tool = register it here (plus export from its package). Nothing else to touch.
 */
import { homedir } from 'node:os'
import { nanoid } from 'nanoid'
import { defaultConfig, type CloneStatus, type MessageEvent, type ModelSelection, type ReplyDraft, type SessionSource, type ToastPayload, type ToolServices } from '@aiwc/protocol'
import {
  createApprovalGate,
  createDelegateTool,
  createHookRunner,
  createKernel,
  createRolloutStore,
  createSkillIndex,
  createToolRegistry,
  createToolRouterFactory,
  planTools,
  skillTools,
} from '@aiwc/kernel'
import { substrateTools, type SourceOpenOptions } from '@aiwc/substrate'
import {
  createCloneBuilder,
  createDiaryPipeline,
  createDiaryStore,
  createMemoryStore,
  createRelationshipStore,
  memoryFragmentProvider,
  memoryTools,
  personaFragmentProvider,
  personaIdentityProvider,
  relationshipFragmentProvider,
  relationshipTools,
} from '@aiwc/memory'
import {
  createAutoReplyRecordStore,
  createAutoReplyService,
  createDesktopAdapter,
  createGateway,
  createIlinkAdapter,
  buildSessionKey,
  createUiInjectSender,
  gatewayTools,
  sourceFromOrigin,
  type DraftHandoff,
} from '@aiwc/gateway'
import type { AppPaths } from './paths'
import type { Logger } from './log'
import { createConfigService } from './config/configService'
import { createSecretStore, SECRET_REFS, type SafeStorageLike } from './config/secretStore'
import { createAllowList } from './security/pathAllowList'
import { customCacheDir, isDirectorySync, validateCacheDir } from './security/cacheDirPolicy'
import { defaultAllowedRoots } from './paths'
import { createModelResolver } from './ai/modelResolver'
import { createSubstrateHost } from './substrate/hostClient'
import { STABLE_SYSTEM_PROMPT } from './prompts/stable'
import { PERSONA_STABLE_PROMPT } from './prompts/persona'
import { observedFragmentProvider, userInstructionsFragmentProvider, wireMemoryInvalidation } from './prompts/fragments'
import { type InboundNames } from './prompts/inbound'
import { createAutoReplyMonitor } from './services/autoReplyMonitor'
import { createAutoReplyGenerator } from './services/autoReplyGenerate'
import { dateHook, memoryToastHook } from './hooks'
import type { AppContext, Broadcast, CloneBuilderLike, CloneStartOptions, SubstrateHostInit, SubstrateMode } from './contracts'

export interface CreateAppDeps {
  paths: AppPaths
  logger: Logger
  broadcast: Broadcast
  safeStorage: SafeStorageLike
  /** dist-electron/substrateHost.js */
  substrateHostEntry: string
  env?: NodeJS.ProcessEnv
}

const DESKTOP_SOURCE: SessionSource = { channel: 'desktop', peerId: 'me', chatId: 'me', chatType: 'dm' }

type PkgLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

export async function createApp(deps: CreateAppDeps): Promise<AppContext> {
  const { paths, logger, broadcast } = deps
  const log = logger.child('app')
  const pkgLogger = (scope: string): PkgLogger => {
    const child = logger.child(scope)
    return (level, msg, meta) => child[level](msg, meta)
  }
  const toast = (payload: ToastPayload) => broadcast('app:toast', payload)
  const unsubscribers: Array<() => void> = []

  // ---- config & secrets ------------------------------------------------------------------------
  const resetWechatSetup = (value: ReturnType<typeof defaultConfig>) => ({
    ...value,
    account: defaultConfig().account,
    onboarding: { completed: false },
  })
  const config = createConfigService({
    file: paths.configFile,
    logger,
    // Account selection and onboarding completion are deliberately process-local for development:
    // every launch starts at the setup wizard while unrelated preferences remain persistent.
    transformLoaded: resetWechatSetup,
    transformPersisted: resetWechatSetup,
  })
  const secrets = createSecretStore({
    file: paths.secretsFile,
    safeStorage: deps.safeStorage,
    logger,
    // WeChat database/image keys are usable after entry or discovery, but never survive a restart.
    sessionOnlyRefs: [SECRET_REFS.dbKey, SECRET_REFS.imageXorKey, SECRET_REFS.imageAesKey],
  })
  const cfg = () => config.get()

  // account.cacheDir is renderer-writable (config:set), so it is never trusted as-is: the substrate
  // only gets it when it is an absolute, non-root, non-home path, and it becomes a file allow-list
  // root only at startup and only when it already exists as a directory. Later changes go through
  // app:pickDirectory (dialog result → root) + the config:set validation, never via config.subscribe.
  const home = homedir()
  const cacheDirOverride = (): string | undefined => {
    const raw = customCacheDir(cfg().account.cacheDir)
    if (!raw) return undefined
    const verdict = validateCacheDir(raw, { home })
    if (!verdict.ok) {
      log.warn('ignoring account.cacheDir', { cacheDir: raw, reason: verdict.reason })
      return undefined
    }
    return verdict.dir
  }
  const startupCacheDir = (() => {
    const dir = cacheDirOverride()
    if (!dir) return undefined
    const verdict = validateCacheDir(dir, { home, isDirectory: isDirectorySync })
    if (!verdict.ok) log.warn('account.cacheDir not added to file allow-list', { cacheDir: dir, reason: verdict.reason })
    return verdict.ok ? verdict.dir : undefined
  })()
  const allowList = createAllowList(defaultAllowedRoots(paths, { cacheDir: startupCacheDir }), { home })

  // ---- substrate (utility process) -------------------------------------------------------------
  // Desktop sessions always come from the configured WeChat database.
  const resolveMode = (): SubstrateMode => 'wcdb'
  const resolveInit = (): SubstrateHostInit => {
    const mode = resolveMode()
    return {
      type: 'init',
      mode,
      nativeDir: mode === 'wcdb' ? paths.nativeDir : undefined,
      mirrorDbPath: paths.mirrorDb,
      cacheDir: cacheDirOverride() ?? paths.mediaCacheDir,
    }
  }
  const resolveOpen = (_mode: SubstrateMode): SourceOpenOptions | undefined => {
    const a = cfg().account
    const cacheDir = cacheDirOverride() ?? paths.mediaCacheDir
    if (!a.dbRoot || !a.wxid || !a.dbKeyRef) return undefined
    const dbKeyHex = secrets.reveal(a.dbKeyRef)
    if (!dbKeyHex) return undefined
    const xorHex = a.imageXorKeyRef ? secrets.reveal(a.imageXorKeyRef) ?? undefined : undefined
    const aesHex = a.imageAesKeyRef ? secrets.reveal(a.imageAesKeyRef) ?? undefined : undefined
    return { dbRoot: a.dbRoot, wxid: a.wxid, dbKeyHex, cacheDir, imageKeys: xorHex || aesHex ? { xorHex, aesHex } : undefined }
  }
  const substrate = createSubstrateHost({ entry: deps.substrateHostEntry, logger, broadcast, resolveInit, resolveOpen })
  try {
    await substrate.start()
  } catch (e) {
    log.error('substrate host failed to start; continuing without data substrate', e)
    toast({ kind: 'error', text: '数据基座启动失败，聊天数据暂不可用', sticky: true })
  }

  // ---- memory -----------------------------------------------------------------------------------
  const memory = createMemoryStore({ dir: paths.memoryDir })
  const relationships = createRelationshipStore({ dir: paths.relationshipsDir })
  const diaries = createDiaryStore({ dir: paths.diariesDir })
  // Stable-tier memory snapshot: frozen per thread, refreshed process-wide whenever a memory file
  // changes (remember/forget tools, 设置 › 记忆 edits, diary backfill) so new threads see the update.
  const memoryFragments = memoryFragmentProvider(memory)
  const personaFragments = personaFragmentProvider({ relationships, substrate, logger: (level, msg, meta) => pkgLogger('persona')(level, msg, meta) })
  unsubscribers.push(wireMemoryInvalidation(memory, memoryFragments))

  // ---- models -----------------------------------------------------------------------------------
  const models = createModelResolver({ config: cfg, secrets, logger })
  let lastAiJson = JSON.stringify(cfg().ai)
  config.subscribe((next) => {
    const aiJson = JSON.stringify(next.ai)
    if (aiJson !== lastAiJson) {
      lastAiJson = aiJson
      models.invalidate()
    }
  })

  // ---- gateway ----------------------------------------------------------------------------------
  // records.db holds rules + audit records + drafts; the gateway reads rules through the callback.
  const records = createAutoReplyRecordStore({ dbPath: paths.recordsDb })
  const gateway = createGateway({
    rules: async () => records.listRules(),
    isAllowed: (source) => source.channel === 'desktop' || source.channel === 'wechat-ilink' || source.channel === 'wechat-ui',
    logger: pkgLogger('gateway'),
  })
  gateway.registerAdapter(
    createIlinkAdapter({
      stateDir: paths.gatewayStateDir,
      persistSession: false,
      onQr: (dataUrl) => broadcast('gateway:event', { type: 'login.qr', channel: 'wechat-ilink', qrDataUrl: dataUrl }),
    }),
  )
  gateway.registerAdapter(createDesktopAdapter())
  // 'wechat-ui' = keyboard injection into the WeChat client, verified by reading the message back from the
  // local DB; a failed verification halts the whole outbound path until the user resumes it.
  const uiSender = createUiInjectSender({
    substrate, platform: process.platform, logger: pkgLogger('ui-inject'),
    canSend: async (req) => {
      if (substrate.mode() === 'demo') return '演示模式不能向真实微信发送消息'
      const state = substrate.status()
      if (req.expectedAccountId && state.account?.wxid !== req.expectedAccountId) return '微信账户已切换，已取消发送'
      if (req.ruleId) {
        const rule = records.getRule(req.to.chatId)
        if (!rule?.enabled || rule.id !== req.ruleId) return '该会话的自动回复已关闭，已取消发送'
      }
      return undefined
    },
  })
  gateway.registerAdapter(uiSender.asAdapter())
  unsubscribers.push(uiSender.events.on((e) => gateway.emit(e)))

  /** draft_reply tool → reply desk (suggest mode, never auto-sent). */
  const handoffDraft = (d: DraftHandoff) => {
    const origin = d.origin
    const source = origin?.chatId ? sourceFromOrigin({ ...origin, chatId: origin.chatId }) : DESKTOP_SOURCE
    const draft: ReplyDraft = {
      id: `drf_${nanoid(10)}`,
      source,
      triggerMessageId: '',
      triggerText: '',
      draft: d.text,
      state: 'pending',
      createdAt: Date.now(),
      mode: 'suggest',
    }
    try {
      autoReply.enqueueDraft(draft)
    } catch (e) {
      log.warn('persist handoff draft failed', e)
    }
    broadcast('autoreply:draft', draft)
    toast({ kind: 'info', text: 'Agent 起草了一条回复，已放入回复台', action: { label: '打开回复台', command: 'tab.openReplyDesk' } })
  }

  // ---- kernel -----------------------------------------------------------------------------------
  const skills = createSkillIndex({
    dirs: [
      { path: paths.skillsBuiltinDir, source: 'builtin' },
      { path: paths.skillsUserDir, source: 'user' },
      { path: paths.skillsAgentDir, source: 'agent' },
    ],
  })
  try {
    await skills.refresh()
  } catch (e) {
    log.warn('skill index refresh failed', e)
  }

  const registry = createToolRegistry()
  const toolDefs = [
    ...substrateTools(),
    ...memoryTools(),
    ...relationshipTools(),
    ...gatewayTools(gateway.outbound, { onDraft: handoffDraft }),
    ...skillTools(skills),
    ...planTools(),
  ]
  for (const tool of toolDefs) registry.register(tool)

  const approvals = createApprovalGate()
  const hooks = createHookRunner({ logger: (level, msg, meta) => logger.child('hooks')[level](msg, meta) })
  hooks.add(dateHook())
  hooks.add(memoryToastHook(toast))
  const rollout = createRolloutStore({ dir: paths.rolloutsDir, indexDbPath: paths.indexDb })

  const toolServices: ToolServices = {
    substrate,
    memory,
    relationships,
    gateway: gateway.outbound,
    skills,
    config: cfg,
  }
  const tools = createToolRouterFactory({ registry, approvals, hooks, services: toolServices })

  const kernel = createKernel({
    services: {
      tools,
      approvals,
      hooks,
      rollout,
      skills,
      models,
      fragmentProviders: [
        memoryFragments, // stable: frozen snapshot, invalidated on memory writes
        personaIdentityProvider({ relationships }), // stable: the clone's identity (persona threads only)
        userInstructionsFragmentProvider(memory), // turn: AGENTS.md live
        relationshipFragmentProvider(relationships), // turn: origin peer profile
        personaFragments, // turn: what this message reminds the clone of (persona threads only)
        observedFragmentProvider(gateway), // turn: unaddressed group chatter
      ],
    },
    config: () => {
      const a = cfg().agent
      return {
        maxStepsPerTurn: a.maxStepsPerTurn,
        compactionThreshold: a.compactionThreshold,
        turnTimeoutMs: a.turnTimeoutMs,
        defaultPermissionMode: a.permissionMode,
        allowAlways: a.allowAlways,
      }
    },
    // A persona thread swaps the whole stable tier: the agent identity forbids exactly what a clone
    // has to do. It also gets no skills index (no tools, so nothing to index).
    systemPrompt: { stable: STABLE_SYSTEM_PROMPT, byProfile: { persona: PERSONA_STABLE_PROMPT }, skillsExcludedProfiles: ['persona'] },
    logger: pkgLogger('kernel'),
  })
  // delegate_analysis needs the kernel to spawn read-only children; the registry is consulted per step,
  // so registering after createKernel is fine.
  registry.register(createDelegateTool(() => kernel))
  log.info('tools registered', { count: registry.list().length, names: registry.list().map((t) => t.name) })

  // ---- auto reply -------------------------------------------------------------------------------
  const resolveNames = async (event: MessageEvent): Promise<InboundNames> => {
    try {
      const contact = await substrate.getContact(event.source.peerId)
      const group = event.source.chatType === 'group' ? await substrate.getSession(event.source.chatId) : undefined
      return { nickname: contact?.remark ?? contact?.nickname ?? event.source.displayName, groupName: group?.title }
    } catch {
      return { nickname: event.source.displayName }
    }
  }
  // The peer's text is third-party data, never the instruction: prompts/inbound wraps it in a bounded
  // fragment and the turn's request is "reply appropriately". Group origins carry peerId (thread per member).
  const generate = createAutoReplyGenerator({ substrate, model: () => models.resolve(cfg().ai.defaultModel), logger: pkgLogger('autoreply-generate') })
  const autoReply = createAutoReplyService({
    gateway,
    records,
    countdownMs: () => cfg().autoReply.countdownMs,
    queueGapMs: () => 2500 + Math.floor(Math.random() * 4501),
    onDraft: (draft) => broadcast('autoreply:draft', draft),
    generate: (event, rule, context) => generate(event, rule, context.signal),
    onRecord: (record) => broadcast('autoreply:record', record),
    canSend: async (draft) => {
      if (draft.source.channel === 'wechat-ui') {
        const state = substrate.status()
        if (state.connection !== 'ready' || !state.account) return '微信数据未连接'
        if (draft.accountId && state.account.wxid !== draft.accountId) return '微信账户已切换，不能发送旧账户的回复'
        if (uiSender.halted) return uiSender.haltReason ?? '自动发送已暂停'
        if (draft.ruleId) {
          const latest = (await substrate.listMessages({ sessionId: draft.source.chatId, limit: 1 })).items.at(-1)
          if (latest?.isSelf || (latest && latest.createdAt > draft.createdAt)) return '会话已有新消息或你已经回复，请重新生成'
        }
      }
      if (draft.ruleId) {
        const rule = records.getRule(draft.source.chatId)
        if (!rule?.enabled || rule.id !== draft.ruleId || rule.pausedReason) return '该会话的自动回复已暂停、删除或变更'
      }
      return undefined
    },
    resolveNames,
    logger: pkgLogger('autoreply'),
  })
  autoReply.start()
  const autoReplyMonitor = createAutoReplyMonitor({
    substrate, rules: () => records.listRules(),
    bindRule: (rule, accountId) => { records.saveRule({ ...rule, accountId }) },
    // A forced trigger goes straight to the service: the gate would only re-check what triggerNow
    // already checked, and the whole point is to re-attempt a message the service has seen.
    ingest: (event, opts) => (opts?.force
      ? autoReply.handle(event, { reply: true, reason: 'ok' }, buildSessionKey(event.source), { force: true })
      : gateway.ingest(event)),
    invalidate: (id, reason) => autoReply.invalidate(id, reason),
    accountChanged: () => autoReply.halt('微信账户已切换，请检查规则后恢复'),
    onError: (error) => log.warn('local auto-reply monitor failed', error),
  })
  // Demo fixtures must never drive real keyboard injection.
  if (substrate.mode() !== 'demo') autoReplyMonitor.start()
  let lastReplyConfig = JSON.stringify(cfg().autoReply)
  unsubscribers.push(config.subscribe(() => {
    const current = JSON.stringify(cfg().autoReply)
    if (current !== lastReplyConfig) {
      lastReplyConfig = current
      for (const rule of records.listRules()) autoReply.invalidate(rule.sessionId, '自动回复设置已更改')
    }
    void autoReplyMonitor.refresh()
  }))
  try {
    await gateway.connect('desktop')
  } catch (e) {
    log.warn('desktop adapter connect failed', e)
  }

  // ---- diary & clone ----------------------------------------------------------------------------
  const diary = createDiaryPipeline({
    substrate,
    memory,
    diaries,
    model: () => models.resolveAuxiliary(),
    rolloutSearch: (q, o) => rollout.search(q, o),
    schedule: () => cfg().diary,
    logger: pkgLogger('diary'),
  })
  diary.start()

  // The builder takes one model getter; the IPC request may name a model per build. Last start wins
  // for concurrent builds with different models (rare: the UI clones one contact at a time).
  let cloneModel: ModelSelection | undefined
  const builder = createCloneBuilder({ substrate, relationships, model: () => models.resolve(cloneModel), logger: pkgLogger('clone') })
  const clone: CloneBuilderLike = {
    start(contactId, opts?: CloneStartOptions) {
      cloneModel = opts?.model
      const { model: _model, ...rest } = opts ?? {}
      return builder.start(contactId, rest)
    },
    cancel: (contactId) => builder.cancel(contactId),
    onStatus: (cb) => builder.onStatus(cb),
  }

  // ---- event bridging ---------------------------------------------------------------------------
  unsubscribers.push(kernel.events.on((e) => broadcast('agent:event', e)))
  unsubscribers.push(
    gateway.events.on((e) => {
      broadcast('gateway:event', e)
      if (e.type === 'autoreply.halted') {
        autoReply.halt(e.reason)
        toast({ kind: 'error', text: `自动回复已熔断：${e.reason}`, sticky: true, action: { label: '查看回复台', command: 'tab.openReplyDesk' } })
      }
    }),
  )
  unsubscribers.push(memory.subscribe((e) => broadcast('memory:changed', e)))

  const lastCloneStatus = new Map<string, string>()
  const pushCloneStatus = (e: { contactId: string; status: CloneStatus }) => {
    const key = JSON.stringify(e.status)
    if (lastCloneStatus.get(e.contactId) === key) return
    lastCloneStatus.set(e.contactId, key)
    broadcast('clone:status', e)
    if (e.status.state === 'ready') toast({ kind: 'success', text: '克隆完成', action: { label: '查看', command: 'tab.openClone' } })
    if (e.status.state === 'failed') toast({ kind: 'error', text: `克隆失败：${e.status.error}`, sticky: true })
  }
  unsubscribers.push(relationships.subscribe(pushCloneStatus))
  unsubscribers.push(clone.onStatus(pushCloneStatus))

  log.info('app composed', { mode: substrate.mode(), skills: skills.list().length, tools: registry.list().length })

  return {
    paths,
    logger,
    config,
    secrets,
    kernel,
    skills,
    models,
    substrate,
    memory,
    relationships,
    diaries,
    diary,
    gateway,
    autoReply,
    autoReplyMonitor,
    records,
    uiSender,
    clone,
    allowList,
    broadcast,
    toast,
    async shutdown() {
      log.info('shutting down')
      for (const u of unsubscribers) {
        try {
          u()
        } catch {
          // ignore
        }
      }
      diary.stop()
      autoReplyMonitor.stop()
      await autoReply.stop()
      try {
        await gateway.shutdown()
      } catch (e) {
        log.warn('gateway shutdown failed', e)
      }
      try {
        await kernel.shutdown()
      } catch (e) {
        log.warn('kernel shutdown failed', e)
      }
      try {
        records.close()
      } catch (e) {
        log.warn('records close failed', e)
      }
      await substrate.shutdown()
      log.info('shutdown complete')
    },
  }
}

export { SECRET_REFS }
