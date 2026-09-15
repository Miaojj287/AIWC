/**
 * Composition root: the ONLY place that knows about every package. createApp() wires config,
 * secrets, substrate (utility process), memory, gateway, kernel, auto-reply, diary and clone
 * builder together and bridges their event streams to the renderer (docs/ARCHITECTURE.md §3).
 *
 * Adding a tool = register it here (plus export from its package). Nothing else to touch.
 */
import { homedir } from 'node:os'
import { nanoid } from 'nanoid'
import {
  type CloneStatus,
  type MessageEvent,
  type ModelSelection,
  type ReplyDraft,
  type SessionSource,
  type ToastPayload,
  type ToolServices,
} from '@aiwc/protocol'
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
  type DraftHandoff,
} from '@aiwc/gateway'
import { createOfficeService, officeTools } from '@aiwc/office'
import { createShellTool } from '@aiwc/shell'
import type { AppPaths } from './paths'
import type { Logger } from './log'
import { resolveLanguage } from '@aiwc/i18n'
import { createConfigService } from './config/configService'
import { setMainLanguage, t } from './i18n'
import { createSecretStore, type SafeStorageLike } from './config/secretStore'
import { createAllowList } from './security/pathAllowList'
import { customCacheDir, isDirectorySync, validateCacheDir } from './security/cacheDirPolicy'
import { defaultAllowedRoots } from './paths'
import { createModelResolver } from './ai/modelResolver'
import { createSubstrateHost } from './substrate/hostClient'
import { STABLE_SYSTEM_PROMPT } from './prompts/stable'
import { PERSONA_STABLE_PROMPT } from './prompts/persona'
import { observedFragmentProvider, userInstructionsFragmentProvider, wireMemoryInvalidation } from './prompts/fragments'
import { type InboundNames } from './prompts/inbound'
import { composeTasks } from './composeTasks'
import { createAutoReplyMonitor } from './services/autoReplyMonitor'
import { createAutoReplyGenerator } from './services/autoReplyGenerate'
import { createPetService } from './services/petService'
import { citationAuditHook, dateHook, memoryToastHook } from './hooks'
import type {
  AppContext,
  Broadcast,
  CloneBuilderLike,
  CloneStartOptions,
  SubstrateHostInit,
  SubstrateMode,
} from './contracts'
import { localizeText } from './localizePayloads'

export interface CreateAppDeps {
  paths: AppPaths
  logger: Logger
  broadcast: Broadcast
  safeStorage: SafeStorageLike
  /** dist-electron/substrateHost.js */
  substrateHostEntry: string
  env?: NodeJS.ProcessEnv
  /** OS locale (`app.getLocale()`); picks the UI language on first launch only. */
  systemLocale?: string
  /** `shell.openExternal`: office authorization links are opened by main, never taken from the renderer. */
  openExternal?: (url: string) => Promise<void>
}

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
  const config = createConfigService({
    file: paths.configFile,
    logger,
    initial: () => ({ general: { language: resolveLanguage(deps.systemLocale) } }),
  })
  // Main-process copy (menu, toasts, dialog titles, errors shown in the UI) follows the setting live.
  setMainLanguage(config.get().general.language)
  unsubscribers.push(config.subscribe((next) => setMainLanguage(next.general.language)))
  const secrets = createSecretStore({
    file: paths.secretsFile,
    safeStorage: deps.safeStorage,
    logger,
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
    if (!verdict.ok)
      log.warn('account.cacheDir not added to file allow-list', { cacheDir: dir, reason: verdict.reason })
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
    const xorHex = a.imageXorKeyRef ? (secrets.reveal(a.imageXorKeyRef) ?? undefined) : undefined
    const aesHex = a.imageAesKeyRef ? (secrets.reveal(a.imageAesKeyRef) ?? undefined) : undefined
    return {
      dbRoot: a.dbRoot,
      wxid: a.wxid,
      dbKeyHex,
      cacheDir,
      imageKeys: xorHex || aesHex ? { xorHex, aesHex } : undefined,
    }
  }
  const substrate = createSubstrateHost({ entry: deps.substrateHostEntry, logger, broadcast, resolveInit, resolveOpen })
  try {
    await substrate.start()
  } catch (e) {
    log.error('substrate host failed to start; continuing without data substrate', e)
    toast({ kind: 'error', text: t('main.substrate.startFailed'), sticky: true })
  }

  // ---- memory -----------------------------------------------------------------------------------
  const memory = createMemoryStore({ dir: paths.memoryDir })
  const relationships = createRelationshipStore({ dir: paths.relationshipsDir })
  const diaries = createDiaryStore({ dir: paths.diariesDir })
  // Stable-tier memory snapshot: frozen per thread, refreshed process-wide whenever a memory file
  // changes (remember/forget tools, 设置 › 记忆 edits, diary backfill) so new threads see the update.
  const memoryFragments = memoryFragmentProvider(memory)
  const personaFragments = personaFragmentProvider({
    relationships,
    substrate,
    logger: (level, msg, meta) => pkgLogger('persona')(level, msg, meta),
  })
  unsubscribers.push(wireMemoryInvalidation(memory, memoryFragments))

  // ---- models -----------------------------------------------------------------------------------
  const models = createModelResolver({ config: cfg, secrets, logger })
  let lastAiJson = JSON.stringify(cfg().ai)
  unsubscribers.push(
    config.subscribe((next) => {
      const aiJson = JSON.stringify(next.ai)
      if (aiJson !== lastAiJson) {
        lastAiJson = aiJson
        models.invalidate()
      }
    }),
  )

  // ---- gateway ----------------------------------------------------------------------------------
  // records.db holds rules + audit records + drafts; the gateway reads rules through the callback.
  const records = createAutoReplyRecordStore({ dbPath: paths.recordsDb })
  const gateway = createGateway({
    rules: async () => records.listRules(),
    isAllowed: (source) =>
      source.channel === 'desktop' || source.channel === 'wechat-ilink' || source.channel === 'wechat-ui',
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
    substrate,
    platform: process.platform,
    logger: pkgLogger('ui-inject'),
    canSend: async (req) => {
      if (substrate.mode() === 'demo') return t('main.autoReply.demoCannotSend')
      const state = substrate.status()
      if (req.expectedAccountId && state.account?.wxid !== req.expectedAccountId)
        return t('main.autoReply.accountSwitchedCancelled')
      if (req.ruleId) {
        const rule = records.getRule(req.to.chatId)
        if (!rule?.enabled || rule.id !== req.ruleId) return t('main.autoReply.ruleClosedCancelled')
      }
      return undefined
    },
  })
  gateway.registerAdapter(uiSender.asAdapter())
  unsubscribers.push(uiSender.events.on((e) => gateway.emit(e)))

  /** draft_reply tool → reply desk: parked until the user presses 发送, never auto-sent. */
  const handoffDraft = async (d: DraftHandoff) => {
    const source: SessionSource = { ...d.to }
    if (!source.displayName) {
      try {
        source.displayName = (await substrate.getSession(source.chatId))?.title
      } catch {
        /* the id is still a usable label */
      }
    }
    const draft: ReplyDraft = {
      id: `drf_${nanoid(10)}`,
      source,
      triggerMessageId: '',
      triggerText: '',
      draft: d.text,
      state: 'pending',
      createdAt: Date.now(),
      mode: 'confirm',
    }
    try {
      autoReply.enqueueDraft(draft)
    } catch (e) {
      log.warn('persist handoff draft failed', e)
    }
    broadcast('autoreply:draft', draft)
    toast({
      kind: 'info',
      text: t('main.autoReply.agentDraftReady', { name: source.displayName ?? source.chatId }),
      action: { label: t('main.autoReply.openReplyDesk'), command: 'tab.openReplyDesk' },
    })
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

  // ---- office platforms -------------------------------------------------------------------------
  // 飞书 / 钉钉 / 企业微信 through their official CLIs. The package host-checks every link before main
  // opens it; npm JS shims run on Electron-as-node when the user has no node on PATH.
  const office = createOfficeService({
    dataDir: `${paths.dataRoot}/office`,
    openExternal:
      deps.openExternal ??
      (async () => {
        throw new Error('openExternal is not available in this host')
      }),
    env: deps.env,
    fallbackNode: process.versions.electron
      ? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
      : undefined,
    logger: pkgLogger('office'),
  })

  // The general shell (ARCHITECTURE §6.1): classified per command, sandboxed to the workspace, never
  // mounted on WeChat bot threads. The office connectors contribute their CLI verbs and state dirs.
  const shell = createShellTool({
    workspaceDir: paths.workspaceDir,
    extraWritableRoots: () => office.writableRoots(),
    protectedPaths: [paths.secretsFile, paths.mirrorDb, paths.indexDb, paths.recordsDb],
    classifiers: [office.commandClassifier()],
    sandboxMode: () => cfg().agent.shellSandbox,
    env: deps.env,
    logger: pkgLogger('shell'),
  })

  const registry = createToolRegistry()
  const toolDefs = [
    ...substrateTools(),
    ...memoryTools(),
    ...relationshipTools(),
    ...gatewayTools(gateway.outbound, { onDraft: handoffDraft }),
    ...skillTools(skills),
    ...planTools(),
    ...officeTools(office),
    shell,
  ]
  for (const tool of toolDefs) registry.register(tool)

  const approvals = createApprovalGate()
  const hooks = createHookRunner({ logger: (level, msg, meta) => logger.child('hooks')[level](msg, meta) })
  hooks.add(dateHook())
  hooks.add(memoryToastHook(toast))
  hooks.add(
    citationAuditHook({ substrate, logger: (level, msg, meta) => logger.child('citation-audit')[level](msg, meta) }),
  )
  const rollout = createRolloutStore({
    dir: paths.rolloutsDir,
    indexDbPath: paths.indexDb,
    logger: pkgLogger('rollout'),
  })

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
    systemPrompt: {
      stable: STABLE_SYSTEM_PROMPT,
      byProfile: { persona: PERSONA_STABLE_PROMPT },
      skillsExcludedProfiles: ['persona'],
    },
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
  const generate = createAutoReplyGenerator({
    substrate,
    model: () => models.resolve(cfg().ai.defaultModel),
    logger: pkgLogger('autoreply-generate'),
  })
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
        if (state.connection !== 'ready' || !state.account) return t('main.autoReply.notConnected')
        if (draft.accountId && state.account.wxid !== draft.accountId)
          return t('main.autoReply.accountSwitchedOldDraft')
        if (uiSender.halted) return uiSender.haltReason ?? t('main.autoReply.autoSendPaused')
        if (draft.ruleId) {
          const latest = (await substrate.listMessages({ sessionId: draft.source.chatId, limit: 1 })).items.at(-1)
          if (latest?.isSelf || (latest && latest.createdAt > draft.createdAt)) return t('main.autoReply.staleDraft')
        }
      }
      if (draft.ruleId) {
        const rule = records.getRule(draft.source.chatId)
        if (!rule?.enabled || rule.id !== draft.ruleId || rule.pausedReason) return t('main.autoReply.ruleChanged')
      }
      return undefined
    },
    resolveNames,
    logger: pkgLogger('autoreply'),
  })
  autoReply.start()
  // 自动回复 (sendMode 'confirm') parks the reply and tells the user where the button is; the toast
  // is keyed per chat so a newer draft for the same chat replaces it instead of stacking.
  unsubscribers.push(
    autoReply.events.on((e) => {
      if (e.type !== 'autoreply.queued') return
      const draft = records.getDraft(e.draftId)
      if (
        !draft ||
        draft.state !== 'pending' ||
        draft.mode !== 'confirm' ||
        !draft.ruleId ||
        draft.triggerMessageId.startsWith('retry_')
      )
        return
      const name = draft.source.displayName ?? draft.source.chatId
      toast({
        id: `autoreply.confirm.${draft.source.chatId}`,
        kind: 'info',
        text: t('main.autoReply.draftReady', { name }),
        action: {
          label: t('main.autoReply.goConfirm'),
          command: 'tab.openAutoReply',
          payload: { sessionId: draft.source.chatId, title: name },
        },
      })
    }),
  )
  const autoReplyMonitor = createAutoReplyMonitor({
    substrate,
    rules: () => records.listRules(),
    bindRule: (rule, accountId) => {
      records.saveRule({ ...rule, accountId })
    },
    // A forced trigger goes straight to the service: the gate would only re-check what triggerNow
    // already checked, and the whole point is to re-attempt a message the service has seen.
    ingest: (event, opts) =>
      opts?.force
        ? autoReply.handle(event, { reply: true, reason: 'ok' }, buildSessionKey(event.source), { force: true })
        : gateway.ingest(event),
    invalidate: (id, reason) => autoReply.invalidate(id, reason),
    accountChanged: () => autoReply.halt(t('main.autoReply.haltAccountSwitched')),
    onError: (error) => log.warn('local auto-reply monitor failed', error),
  })
  // Demo fixtures must never drive real keyboard injection.
  if (substrate.mode() !== 'demo') autoReplyMonitor.start()
  let lastReplyConfig = JSON.stringify(cfg().autoReply)
  unsubscribers.push(
    config.subscribe(() => {
      const current = JSON.stringify(cfg().autoReply)
      if (current !== lastReplyConfig) {
        lastReplyConfig = current
        for (const rule of records.listRules())
          autoReply.invalidate(rule.sessionId, t('main.autoReply.settingsChanged'))
      }
      void autoReplyMonitor.refresh()
    }),
  )
  try {
    await gateway.connect('desktop')
  } catch (e) {
    log.warn('desktop adapter connect failed', e)
  }

  // ---- pets -------------------------------------------------------------------------------------
  // Bundled pets are copied into <dataRoot>/pets so every pet is served from the same allow-listed root.
  const pets = createPetService({ petsDir: paths.petsDir, builtinDir: paths.petsBuiltinDir, logger })
  try {
    await pets.seedBuiltin()
  } catch (e) {
    log.warn('bundled pets not seeded', e)
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

  // ---- 定时任务 (composeTasks.ts) -------------------------------------------------------------------
  const tasks = composeTasks({ dir: paths.tasksDir, kernel, broadcast, toast, logger: pkgLogger('tasks') })
  tasks.start()

  // The builder takes one model getter; the IPC request may name a model per build. Last start wins
  // for concurrent builds with different models (rare: the UI clones one contact at a time).
  let cloneModel: ModelSelection | undefined
  const builder = createCloneBuilder({
    substrate,
    relationships,
    model: () => models.resolve(cloneModel),
    logger: pkgLogger('clone'),
  })
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
        toast({
          kind: 'error',
          text: t('main.autoReply.halted', { reason: localizeText(e.reason) }),
          sticky: true,
          action: { label: t('main.autoReply.viewReplyDesk'), command: 'tab.openReplyDesk' },
        })
      }
    }),
  )
  unsubscribers.push(memory.subscribe((e) => broadcast('memory:changed', e)))
  unsubscribers.push(office.onSession((session) => broadcast('office:session', session)))

  const lastCloneStatus = new Map<string, string>()
  const pushCloneStatus = (e: { contactId: string; status: CloneStatus }) => {
    const key = JSON.stringify(e.status)
    if (lastCloneStatus.get(e.contactId) === key) return
    lastCloneStatus.set(e.contactId, key)
    broadcast('clone:status', e)
    if (e.status.state === 'ready')
      toast({
        kind: 'success',
        text: t('main.clone.done'),
        action: { label: t('main.clone.view'), command: 'tab.openClone' },
      })
    if (e.status.state === 'failed')
      toast({ kind: 'error', text: t('main.clone.failed', { error: localizeText(e.status.error) }), sticky: true })
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
    pets,
    office,
    tasks,
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
      // Waiting device-flow pollers are detached process groups: stop them before anything else.
      office.shutdown()
      tasks.stop()
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
