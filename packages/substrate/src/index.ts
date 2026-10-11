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
export { acquireKeys, type RelaunchCapture } from './key'
// Low-level scanners + path helpers the electron host needs for the last-resort relaunch capture.
export { scanMacDbKey, scanMacDbKeyFromDumps } from './key/macosMemoryScanner'

export { findWeChatPidSync } from './discovery/processDetect'
// Where the SQLCipher engine keeps plaintext copies of WeChat's databases: the main process has to
// fence that directory off, and a second spelling of the name would drift the day this one moves.
export { decryptedCopyDir } from './wcdb/decryptedCopy'
export * from './decrypt'

// tools (owner: substrate-tools)
export { substrateTools } from './tools'
// The one model-facing view of a message (cite link, sender, bounded text): the host renders the messages a user
// quoted to the Agent with it, so they read exactly like tool results.
export { compactMessage, MAX_ANCHOR_TEXT_CHARS, MAX_TEXT_CHARS } from './tools/shared'

export { resolveAccountDir } from './wcdb/dbFiles'
