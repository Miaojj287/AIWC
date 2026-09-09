/**
 * @aiwc/substrate — WeChat data substrate: source readers (WCDB / demo), the agent-owned SQLite
 * mirror (FTS5 unicode61 + trigram, chunk vectors), the SubstrateService facade, utility-process
 * hosting (JSON-RPC over MessagePort), discovery / key acquisition, and the agent tool set.
 * Exports follow docs/PACKAGE-API.md "@aiwc/substrate".
 */
export type { SourceReader, SourceOpenOptions } from './source'

// core (this module's owner)
export { createMirror } from './mirror'
export type {
  Mirror,
  MirrorOptions,
  SessionFlags,
  GroupMemberInput,
  InsertResult,
  SearchFilters,
  EnsureChunksResult,
  EnsureChunksOptions,
  ListContactsQuery,
  VectorSearchHit,
  BuiltChunk,
  ChunkInput,
  RrfRankedItem,
  RrfMergedItem,
  FtsQueries,
} from './mirror'
export { buildChunks, chunkExcerpt, reciprocalRankFusion, fuseHits, alignVectorHits, hitKey, buildFtsQueries, MIRROR_SCHEMA_VERSION } from './mirror'
export { createSubstrateFacade, createSyncEngine } from './facade'
export type { SubstrateFacade, SubstrateFacadeOptions, SyncEngine, SyncEngineDeps, SyncRunOptions } from './facade'
export { createDemoSourceReader, normaliseFixture, FixtureSchema, WxAccountSchema, WxSessionSchema, WxContactSchema, WxMessageSchema, WxMediaSchema } from './demo'
export type { DemoSourceOptions, Fixture, FixtureInput, NormalisedFixture } from './demo'
export { serveSubstrate, createSubstrateClient, attachPort, RPC_METHODS, DEFAULT_TIMEOUT_MS, SYNC_TIMEOUT_MS, OPEN_TIMEOUT_MS } from './host'
export type {
  SubstrateClient,
  SubstrateClientOptions,
  PortLike,
  HostedService,
  SubstrateExtras,
  RpcRequest,
  RpcResponse,
  RpcEvent,
  RpcStatus,
  RpcError,
  RpcMessage,
  RpcMethod,
  ServiceStatus,
} from './host'
export * from './normalize'
export * from './shared'

// wcdb / key / discovery / decrypt (owner: substrate-wcdb)
export { createWcdbSourceReader } from './wcdb'
export { detectWeChat, listAccounts, verifyAccount } from './discovery'
export { acquireKeys, validateKeyHex } from './key'
// Low-level scanners + path helpers the electron host needs for the last-resort relaunch capture.
export { scanMacDbKey, scanMacDbKeyFromDumps, captureMacDbKeyViaHook, isSipEnabled, type MacScanResult } from './key/macosMemoryScanner'
export { findSessionDbCandidates, resolveDbStoragePath } from './wcdb/dbFiles'
export { findWeChatPidSync, listWeChatProcesses } from './discovery/processDetect'
export * from './decrypt'

// tools (owner: substrate-tools)
export { substrateTools } from './tools'
