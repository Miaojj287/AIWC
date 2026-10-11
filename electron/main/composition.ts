/**
 * Composition root: the ONLY place that knows about every package. createApp() wires config,
 * secrets, substrate (utility process), memory, gateway, kernel, auto-reply, 每日待办 and clone
 * builder together and bridges their event streams to the renderer (docs/ARCHITECTURE.md §3).
 *
 * Adding a tool = register it here (plus export from its package). Nothing else to touch.
 */
import { createAccountRuntime } from './services/accountRuntime'
import { nanoid } from 'nanoid'
import {
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
  askUserTool,
  createQuestionGate,
  planTools,
  skillTools,
} from '@aiwc/kernel'
import { substrateTools, type SourceOpenOptions } from '@aiwc/substrate'
import {
  createCloneBuilder,
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
import { substrateCacheDir } from './paths'
import { composeFileAccess } from './composeFileAccess'
import { composeModels } from './composeModels'
import { createSubstrateHost } from './substrate/hostClient'
import { STABLE_SYSTEM_PROMPT } from './prompts/stable'
import { PERSONA_STABLE_PROMPT } from './prompts/persona'
import { observedFragmentProvider, userInstructionsFragmentProvider, wireMemoryInvalidation } from './prompts/fragments'
import { createAllowedTextReader, mentionFragmentProvider } from './prompts/mentionFragments'
import { createAttentionNotices } from './composeNotifications'
import { createCloneStatusReporter, reportConfirmDrafts } from './composeReports'
import type { AttentionNotice } from './services/systemNotifier'
import { composeTasks } from './composeTasks'
import { composeExtensions } from './composeExtensions'
import { composeMobile } from './composeMobile'
import { composePrivacy, type PrivacyHost } from './composePrivacy'
import { composeTodo } from './composeTodo'
import { composeMemoryReview } from './composeMemory'
import { createAutoReplyMonitor } from './services/autoReplyMonitor'
import { createAutoReplyGenerator } from './services/autoReplyGenerate'
import { createInboundNameResolver } from './services/autoReplyNames'
import { createJevClient } from './services/jevClient'
import { createJevReplyDecider } from './services/jevReply'
import { createPetService } from './services/petService'
import { citationAuditHook, dateHook } from './hooks'
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
  /** System notifications while the window is in the background (index.ts: services/systemNotifier.ts). */
  attention?: (notice: AttentionNotice) => void
  /** `session.defaultSession.resolveProxy`: 跟随系统 for requests to model providers. */
  resolveProxy?: (url: string) => Promise<string>
  /** Accessibility check, build fingerprint and trash for composePrivacy (index.ts, via electron). */
  privacyHost?: PrivacyHost
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

  // Custom cache dir, renderer file allow-list and protected stores (composeFileAccess.ts).
  const { cacheDirOverride, allowList, protectedPaths } = composeFileAccess({ paths, config: cfg, log })

  // Desktop sessions always come from the configured WeChat database.
  const resolveMode = (): SubstrateMode => 'wcdb'
  const resolveInit = (): SubstrateHostInit => {
    const mode = resolveMode()
    return {
      type: 'init',
      mode,
      nativeDir: mode === 'wcdb' ? paths.nativeDir : undefined,
      mirrorDbPath: paths.mirrorDb,
      cacheDir: substrateCacheDir(paths, cacheDirOverride()),
    }
  }
  const resolveOpen = (_mode: SubstrateMode): SourceOpenOptions | undefined => {
    const a = cfg().account
    const cacheDir = substrateCacheDir(paths, cacheDirOverride())
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

  const memory = createMemoryStore({ dir: paths.memoryDir, maxEntries: () => cfg().memory.maxEntries })
  const memoryReview = composeMemoryReview({ dir: paths.memoryDir, memory, config: cfg, broadcast, toast, logger })
  unsubscribers.push(memoryReview.dispose)
  const relationships = createRelationshipStore({ dir: paths.relationshipsDir })
  // Stable-tier memory snapshot: frozen per thread, refreshed process-wide whenever a memory file
  // changes (remember/forget tools, 设置 › 记忆 edits) so new threads see the update.
  const memoryFragments = memoryFragmentProvider(memory)
  const personaFragments = personaFragmentProvider({
    relationships,
    substrate,
    logger: (level, msg, meta) => pkgLogger('persona')(level, msg, meta),
  })
  unsubscribers.push(wireMemoryInvalidation(memory, memoryFragments))

  const { models, modelOps } = composeModels({ ...deps, config, secrets, unsubscribers })

  // records.db holds rules + audit records + drafts; the gateway reads rules through the callback.
  const records = createAutoReplyRecordStore({ dbPath: paths.recordsDb })
  const gateway = createGateway({
    rules: async () => records.listRules(),
    isAllowed: (source) =>
      source.channel === 'desktop' || source.channel === 'wechat-ilink' || source.channel === 'wechat-ui',
    logger: pkgLogger('gateway'),
  })
  // The iLink adapter (我的微信) is registered by composeMobile, once the kernel exists.
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
    notices.agentDraft(source.displayName)
  }

  const skills = createSkillIndex({
    dirs: [
      { path: paths.skillsBuiltinDir, source: 'builtin' },
      { path: paths.skillsUserDir, source: 'user' },
      { path: paths.skillsAgentDir, source: 'agent' },
    ],
    disabled: () => config.get().agent.disabledSkills,
    onRefresh: (entries) => broadcast('skills:changed', { skills: entries }),
  })
  try {
    await skills.refresh()
  } catch (e) {
    log.warn('skill index refresh failed', e)
  }

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
    dataRoot: paths.dataRoot,
    extraWritableRoots: () => office.writableRoots(),
    protectedPaths,
    classifiers: [office.commandClassifier()],
    sandboxMode: () => cfg().agent.shellSandbox,
    env: deps.env,
    logger: pkgLogger('shell'),
  })

  const registry = createToolRegistry()
  const toolDefs = [
    ...substrateTools(),
    ...memoryTools(memoryReview.toolOptions),
    ...relationshipTools(),
    ...gatewayTools(gateway.outbound, { onDraft: handoffDraft }),
    ...skillTools(skills),
    ...planTools(),
    askUserTool(),
    ...officeTools(office),
    shell,
  ]
  for (const tool of toolDefs) registry.register(tool)

  const approvals = createApprovalGate()
  const questions = createQuestionGate()
  const hooks = createHookRunner({ logger: (level, msg, meta) => logger.child('hooks')[level](msg, meta) })
  hooks.add(dateHook())
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
  const tools = createToolRouterFactory({ registry, approvals, questions, hooks, services: toolServices })

  const kernel = createKernel({
    services: {
      tools,
      approvals,
      questions,
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
        mentionFragmentProvider({
          substrate,
          readTextFile: createAllowedTextReader(allowList),
          logger: pkgLogger('mentions'),
        }), // turn: quoted messages + @files
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
    onGlobalGrant: (key) => privacy.grants.addGlobal(key),
  })
  const privacy = composePrivacy({
    ...paths,
    ...{ config, kernel, memory, skills, hooks, broadcast, host: deps.privacyHost, logger },
    gatewayEvents: gateway.events,
    chatName: async (chatId) => (await substrate.getSession(chatId).catch(() => undefined))?.title,
  })
  unsubscribers.push(privacy.dispose)
  const notices = createAttentionNotices({
    attention: deps.attention,
    showNames: () => cfg().general.notifications.showNames,
    kernel,
    logger: pkgLogger('notify'),
  })
  unsubscribers.push(notices.dispose)
  // delegate_analysis needs the kernel to spawn read-only children; the registry is consulted per step,
  // so registering after createKernel is fine.
  registry.register(createDelegateTool(() => kernel))
  // 扩展 (composeExtensions.ts): MCP tools, user hooks, workflow_run.
  const extensions = composeExtensions({
    ...{ paths, secrets, registry, hooks, kernel, broadcast, logger, env: deps.env, protectedPaths },
    fallbackNode: process.versions.electron
      ? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
      : undefined,
    sandboxMode: () => cfg().agent.shellSandbox,
  })
  memoryReview.start({ kernel, secrets, model: modelOps.lowEffortModel })
  log.info('tools registered', { count: registry.list().length, names: registry.list().map((t) => t.name) })

  const resolveNames = createInboundNameResolver(substrate)
  // The peer's text is third-party data, never the instruction: prompts/inbound wraps it in a bounded
  // fragment and the turn's request is "reply appropriately". Group origins carry peerId (thread per member).
  const generate = createAutoReplyGenerator({
    substrate,
    model: () => models.forFeature('autoReply').resolve(cfg().ai.defaultModel),
    logger: pkgLogger('autoreply-generate'),
  })
  // 自动回复的 Jev（beta）回复方式: Jev only chooses between the rule's own candidates (services/jevReply.ts).
  const jev = createJevClient({ config: cfg, secrets, fetch: modelOps.network.fetch, logger: pkgLogger('jev') })
  const jevReply = createJevReplyDecider({ substrate, jev, resolveNames, logger: pkgLogger('jev-reply') })
  const autoReply = createAutoReplyService({
    gateway,
    records,
    countdownMs: () => cfg().autoReply.countdownMs,
    queueGapMs: () => 2500 + Math.floor(Math.random() * 4501),
    onDraft: (draft) => broadcast('autoreply:draft', draft),
    generate: (event, rule, context) =>
      rule.source === 'jev' ? jevReply.generate(event, rule, context.signal) : generate(event, rule, context.signal),
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
  unsubscribers.push(
    reportConfirmDrafts({ events: autoReply.events, getDraft: (id) => records.getDraft(id), toast, notices }),
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

  // Bundled pets are copied into <dataRoot>/pets so every pet is served from the same allow-listed root.
  const pets = createPetService({ petsDir: paths.petsDir, builtinDir: paths.petsBuiltinDir, logger })
  try {
    await pets.seedBuiltin()
  } catch (e) {
    log.warn('bundled pets not seeded', e)
  }

  const todo = composeTodo({
    dir: paths.todoDir,
    substrate,
    resolveModel: (selection) => models.forFeature('todo').resolve(selection),
    config: () => cfg().todo,
    onConfigChange: (listener) => config.subscribe(listener),
    broadcast,
    toast,
    logger: pkgLogger('todo'),
  })

  const mobile = composeMobile({
    dir: paths.mobileDir,
    gatewayStateDir: paths.gatewayStateDir,
    gateway,
    kernel,
    secrets,
    broadcast,
    logger: pkgLogger('mobile'),
  })
  const tasks = composeTasks({
    dir: paths.tasksDir,
    kernel,
    broadcast,
    toast,
    notify: notices.taskRun,
    registry,
    attention: deps.attention,
    onFinished: (run, task) => void mobile.pushTaskRun(run, task),
    logger: pkgLogger('tasks'),
  })

  // The builder takes one model getter; the IPC request may name a model per build. Last start wins
  // for concurrent builds with different models (rare: the UI clones one contact at a time).
  let cloneModel: ModelSelection | undefined
  const builder = createCloneBuilder({
    substrate,
    relationships,
    model: () => models.forFeature('clone').resolve(cloneModel),
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
        notices.autoReplyHalted()
      }
    }),
  )
  unsubscribers.push(memory.subscribe((e) => broadcast('memory:changed', e)))
  unsubscribers.push(office.onSession((session) => broadcast('office:session', session)))

  const pushCloneStatus = createCloneStatusReporter({ broadcast, toast })
  unsubscribers.push(relationships.subscribe(pushCloneStatus))
  unsubscribers.push(clone.onStatus(pushCloneStatus))

  log.info('app composed', { mode: substrate.mode(), skills: skills.list().length, tools: registry.list().length })

  return {
    activate: createAccountRuntime([
      extensions.start,
      autoReply.start,
      () => {
        if (substrate.mode() !== 'demo') autoReplyMonitor.start()
      },
      todo.start,
      mobile.start,
      tasks.start,
    ]),
    paths,
    logger,
    config,
    secrets,
    kernel,
    skills,
    models,
    modelOps,
    substrate,
    memory,
    memoryReview,
    relationships,
    todo,
    gateway,
    autoReply,
    autoReplyMonitor,
    records,
    jev,
    uiSender,
    clone,
    pets,
    office,
    tasks,
    mobile,
    extensions: extensions.service,
    privacy,
    allowList,
    protectedPaths,
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
      await tasks.flush()
      await extensions.shutdown().catch((e: unknown) => log.warn('extensions shutdown failed', e))
      mobile.dispose()
      todo.dispose()
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
