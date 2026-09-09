# 包公开 API（组合根依赖的导出面）

> 并行实现时的约定：每个包的 `src/index.ts` **必须**导出下面列出的符号（签名可更精确，不可更窄）。组合根 `electron/main` 只依赖这里列出的东西。未列出的内部结构随意。

## @aiwc/kernel

```ts
// runtime
export interface Kernel {
  submit(op: Op): Promise<void>                       // 唯一入口；未知 threadId → 抛错
  events: { on(listener: (e: Event) => void): () => void }
  listThreads(opts?: { query?: string; limit?: number; channel?: ChannelKind }): Promise<ThreadRecord[]>
  getThread(threadId: ThreadId): Promise<{ record: ThreadRecord; items: HistoryItem[] } | undefined>
  /** ensure a thread is loaded (from rollout) or created for an external origin (wechat chat) */
  ensureThread(origin: ThreadOrigin, settings?: Partial<ThreadSettings>, threadId?: ThreadId): Promise<ThreadId>
  /** convenience for gateway/cron: run one turn and resolve with the final text */
  runOnce(threadId: ThreadId, input: UserInput, opts?: { signal?: AbortSignal }): Promise<{ text: string; artifacts: ToolArtifact[] }>
  updateMeta(threadId: ThreadId, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<void>
  removeThread(threadId: ThreadId): Promise<void>
  shutdown(): Promise<void>
}
export interface KernelOptions {
  services: KernelServices                            // packages/kernel/src/ports.ts
  config: () => { maxStepsPerTurn: number; compactionThreshold: number; turnTimeoutMs: number; defaultPermissionMode: PermissionMode; allowAlways: string[] }
  systemPrompt: { stable: string /* 身份+规则 */; }
  logger?: (level: 'debug'|'info'|'warn'|'error', msg: string, meta?: unknown) => void
}
export function createKernel(opts: KernelOptions): Kernel

export function createAiSdkModelClient(input: { provider: ProviderConfig; model: ModelEntry; apiKey?: string }): ModelClient
export function createMockModelClient(script: MockScript): ModelClient   // for tests & web mode
export function testModel(input: { provider: ProviderConfig; modelId: string; apiKey?: string }): Promise<ModelTestResult>
export function listRemoteModels(input: { provider: ProviderConfig; apiKey?: string }): Promise<string[]>

// tooling
export function createToolRegistry(): ToolRegistry
export function createToolRouterFactory(deps: { registry: ToolRegistry; approvals: ApprovalGate; hooks: HookRunner; services: ToolServices; policy?: { defaultTimeoutMs?: number; maxOutputChars?: number } }): ToolRouterFactory
export function createApprovalGate(): ApprovalGate
export function createHookRunner(): HookRunner
export function createRolloutStore(opts: { dir: string /* rollouts/ */; indexDbPath: string /* index.db (node:sqlite) */ }): RolloutStore
export function createSkillIndex(opts: { dirs: Array<{ path: string; source: 'builtin' | 'user' | 'agent' }> }): SkillIndex
export function skillTools(index: SkillIndex): ToolDefinition[]          // skill_view, skill_manage(create/patch)
export function planTools(): ToolDefinition[]                            // update_plan
```

## @aiwc/substrate

```ts
export type { SourceReader, SourceOpenOptions } from './source'
export function createDemoSourceReader(opts: { fixturePath: string }): SourceReader
export function createWcdbSourceReader(opts: { nativeDir: string /* resources/native/<platform> */ }): SourceReader
export function createMirror(opts: { dbPath: string; embeddings?: EmbeddingClient }): Mirror            // node:sqlite; FTS5 unicode61 + trigram; vectors table
export function createSubstrateFacade(opts: { source: SourceReader; mirror: Mirror; transcriber?: VoiceTranscriber; cacheDir: string }): SubstrateService & { openWith(opts: SourceOpenOptions): Promise<void>; close(): Promise<void> }
// utility-process hosting
export function serveSubstrate(service: SubstrateService & { openWith: Function; close: Function }, port: import('node:worker_threads').MessagePort | Electron.MessagePortMain): () => void
export function createSubstrateClient(post: (msg: unknown) => void, onMessage: (cb: (msg: unknown) => void) => void): SubstrateService & { openWith(opts: SourceOpenOptions): Promise<void>; close(): Promise<void> }
// discovery & keys (main-process side, no UI)
export function detectWeChat(): Promise<{ running: boolean; dbRoot?: string; version?: string; pid?: number }>
export function listAccounts(dbRoot: string): Promise<WxAccount[]>
export function verifyAccount(opts: { dbRoot: string; wxid: string; dbKeyHex?: string }): Promise<{ ok: boolean; error?: string }>
export function acquireKeys(opts: { dbRoot: string; wxid: string; strategy: 'auto' | 'memory_scan'; nativeDir: string; onStep: (step: KeyAcquireStep) => void }): Promise<{ dbKeyHex?: string; imageXorHex?: string; imageAesHex?: string; steps: KeyAcquireStep[] }>
export function validateKeyHex(hex: string): { ok: boolean; error?: string }
// tools
export function substrateTools(): ToolDefinition<any, { substrate: SubstrateService }>[]
```

## @aiwc/memory

```ts
export function createMemoryStore(opts: { dir: string; limits?: Partial<Record<MemoryFile, number>> }): MemoryStore
export function createRelationshipStore(opts: { dir: string }): RelationshipStore
export function createDiaryStore(opts: { dir: string }): DiaryStore
export function createDiaryPipeline(deps: { substrate: SubstrateService; memory: MemoryStore; diaries: DiaryStore; model: () => Promise<ModelClient>; rolloutSearch?: RolloutStore['search']; schedule: () => { enabled: boolean; hour: number; customPrompt?: string } }): DiaryPipeline & { start(): void; stop(): void }
export function memoryFragmentProvider(store: MemoryStore): FragmentProvider      // stable tier: frozen snapshot
export function relationshipFragmentProvider(store: RelationshipStore): FragmentProvider  // turn tier: profile of the origin peer
export function memoryTools(): ToolDefinition<any, { memory: MemoryStore }>[]     // remember / recall / forget / list_memories
export function relationshipTools(): ToolDefinition<any, { relationships: RelationshipStore; substrate: SubstrateService }>[]  // get_relationship_profile
export function createCloneBuilder(deps: { substrate: SubstrateService; relationships: RelationshipStore; model: () => Promise<ModelClient> }): { start(contactId: string, opts?: {...}): Promise<void>; cancel(contactId): void; onStatus(cb): () => void }
```

## @aiwc/gateway

```ts
export interface Gateway {
  registerAdapter(adapter: PlatformAdapter): void
  connect(channel: ChannelKind): Promise<void>
  disconnect(channel: ChannelKind): Promise<void>
  status(): Array<{ channel: ChannelKind; state: AdapterState; detail?: string }>
  /** normalised inbound stream after authz + reply gate; `decision` tells the host what to do */
  onInbound(handler: (event: MessageEvent, decision: ReplyDecision, sessionKey: SessionKey) => void | Promise<void>): () => void
  outbound: GatewayOutbound                          // enforces origin-only for wechat channels
  events: { on(listener: (e: GatewayEvent) => void): () => void }
  observed: { take(chatId: string, max?: number): MessageEvent[]; fragment(chatId: string): ContextFragment | undefined }
}
export function createGateway(deps: { rules: () => Promise<AutoReplyRule[]>; config: () => { globalEnabled: boolean; quietHours?: {start,end} } }): Gateway
export function buildSessionKey(source: SessionSource): SessionKey
export function createReplyGate(deps: {...}): { decide(event: MessageEvent, rule?: AutoReplyRule): ReplyDecision }
export function createAutoReplyService(deps: { gateway: Gateway; records: AutoReplyRecordStore; countdownMs: () => number; onDraft: (d: ReplyDraft) => void }): AutoReplyService  // suggest/confirm/auto queue, countdown, halt latch, resolveDraft
export function createIlinkAdapter(opts: { stateDir: string; onQr: (dataUrl: string) => void }): PlatformAdapter   // channel 'wechat-ilink'
export function createUiInjectSender(deps: { substrate: SubstrateService; platform: 'darwin' | 'win32' }): { send(req: SendRequest): Promise<SendResult> }  // DB read-back verification
export function createDesktopAdapter(): PlatformAdapter & { inject(event: MessageEvent): void }                    // channel 'desktop'
export function gatewayTools(outbound: GatewayOutbound): ToolDefinition<any, { gateway: GatewayOutbound }>[]       // send_message (origin-only), send_media
export function createAutoReplyRecordStore(opts: { dbPath: string }): AutoReplyRecordStore
```

## electron/main（组合根导出给 IPC 层）

- `electron/main/composition.ts`：`createApp()` 把上面所有 `create*` 接起来，返回 `{ kernel, substrate, memory, gateway, diary, config, secrets }`。
- `electron/main/ipc/*.ts`：每个 `InvokeMap` 前缀一个文件（`app`, `config`, `ai`, `substrate`, `agent`, `memory`, `clone`, `autoreply`, `gateway`, `diary`, `file`）。
- `electron/main/index.ts` 支持 `--smoke`：启动 → 窗口 ready → 渲染层发 `app:getInfo` 成功 → 退出码 0；15 秒内没完成退出码 1。

## 补充约定（构建期收敛）

- `planTools()` 的 `update_plan` 通过 `ctx.services.emit(event)` 上报 `plan.updated`；组合根必须在 ToolServices 里注入 `emit: (e: Event) => void`（kernel 事件总线的 emit）。
- `ToolRouterFactory.build()` 的选项已扩展为 `ToolRouterBuildOptions`（`permissionMode` / `allowAlways` / `onAllowAlways` 三个运行时 getter，均可选）；runtime 每个 Step 构建 router 时传入。
- `createFragment(kind, marker, tokenCap, render)` 与 `truncateToTokens(text, cap)` 现位于 `@aiwc/protocol`（fragments.ts）；各包的片段提供者应改用它，不再各自实现。
- `StatsResult.rows` 的规范键名见 `protocol/substrate.ts` 注释；mirror 实现与工具消费方都以它为准。
- `packages/substrate/src/index.ts` 必须 `export { substrateTools } from './tools'`。

## 已交付实现与本文的差异（2026-09-06 构建后校准）

以下以代码为准：
- `@aiwc/gateway`：`createAutoReplyService(deps)` 的 deps 实际为 `{ gateway, records, countdownMs, onDraft, generate(event, rule, ctx), mode?, onRecord?, onHandoff?, resolveNames?, supportsRecall?, now?, tickMs?, draftTtlMs?, logger? }`；`AutoReplyRecordStore`（同步 node:sqlite）同时管理 rules / records / drafts（`listRules/getRule/saveRule/setEnabled/deleteRule`、`listRecords/addRecord/updateRecord/countToday`、`listDrafts/saveDraft/deleteDraft`）。`withOriginGuard(outbound, origin)` 供 `gatewayTools` 做 origin-only。
- `@aiwc/substrate`：`createSubstrateClient(post, onMessage, options?)` 返回 `HostedService & SubstrateExtras & { dispose(); refreshStatus() }`；`SubstrateExtras`（setSessionFlags / removeIndex / rebuildIndex）现已作为可选成员并入 protocol 的 `SubstrateService`。`FixtureSchema` 为演示数据的 zod 契约。
- `@aiwc/kernel`：`createDelegateTool(getKernel: () => KernelInternal)`；`ToolRouterFactory.build(ToolRouterBuildOptions)`；`createFragment` / `truncateToTokens` 统一为 `@aiwc/protocol` 的实现（kernel 各半边与 memory 均 re-export，不再各自实现）。
- `@aiwc/memory`：`createRelationshipStore` 返回 `RelationshipStoreExt`（含 setStatus / appendCorrection / listCorrections / clearCorrections，现已作为可选成员并入 protocol 的 `RelationshipStore`）；`createCloneBuilder` 的 `model` 接受可选的 `ModelSelection` 参数。
- `@aiwc/protocol` 新增：`FragmentProvider` / `FragmentProviderContext`（kernel ports 改为 re-export）、`SearchHit.range?`、`ToastPayload.action.payload?`、`EventMap['substrate:keyStep']`、`PlatformAdapter.recall?`、`config.autoReply.mode`。
