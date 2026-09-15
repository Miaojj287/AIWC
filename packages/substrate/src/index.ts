/**
 * @aiwc/substrate — WeChat data substrate: source readers (WCDB / demo), the agent-owned SQLite
 * mirror (FTS5 unicode61 + trigram, chunk vectors), the SubstrateService facade, utility-process
 * hosting (JSON-RPC over MessagePort), discovery / key acquisition, and the agent tool set.
 * Exports follow docs/PACKAGE-API.md "@aiwc/substrate".
 */
export type { SourceReader, SourceOpenOptions } from './source'

// core (this module's owner)
export { createMirror } from './mirror'

export { createSubstrateFacade } from './facade'

export { serveSubstrate, createSubstrateClient } from './host'
export type { SubstrateClient } from './host'
export * from './normalize'
export * from './shared'

// wcdb / key / discovery / decrypt (owner: substrate-wcdb)
export { createWcdbSourceReader } from './wcdb'
export { detectWeChat, listAccounts, verifyAccount } from './discovery'
export { acquireKeys } from './key'
// Low-level scanners + path helpers the electron host needs for the last-resort relaunch capture.
export { scanMacDbKey, scanMacDbKeyFromDumps } from './key/macosMemoryScanner'

export { findWeChatPidSync } from './discovery/processDetect'
export * from './decrypt'

// tools (owner: substrate-tools)
export { substrateTools } from './tools'
